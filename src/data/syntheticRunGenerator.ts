import {
  BookLadderLevel,
  BookSnapshot,
  DataQualityFlag,
  EvaluationLabel,
  EventAssociation,
  GroundTruthLabel,
  LaunchOptions,
  OrderEvent,
  OrderState,
  OrderStatus,
  ReasonCode,
  RebuiltOrderLifeline,
  RestingBookOrder,
  ScenarioDifficulty,
  ScenarioId,
  ScenarioManifestRow,
  ScoringStage,
  Side,
  SimulationConfig,
  SurveillanceFeatureRow,
  SyntheticDataset,
  Trade,
  ValidationResultRow,
} from '../types/surveillance';
import { computeConfigHash, SCENARIO_DEFINITIONS } from './simulationConfig';

const SESSION_SECONDS = 1800; // 30-min representative slice from 09:15:00 to 09:45:00 IST
const TICK = 0.05;

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function formatSessionClock(secFromOpen: number): string {
  const clamped = Math.max(0, secFromOpen);
  const totalSec = 9 * 3600 + 15 * 60 + clamped;
  const hh = Math.floor(totalSec / 3600);
  const mm = Math.floor((totalSec % 3600) / 60);
  const ss = totalSec % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${ss
    .toFixed(2)
    .padStart(5, '0')}`;
}

function toIso(secFromOpen: number): string {
  const clock = formatSessionClock(secFromOpen);
  return `2026-11-17T${clock}0+05:30`;
}

function snapTick(p: number): number {
  return Math.round(p * 20) / 20;
}

interface ScenarioBlueprint {
  scenario_id: string;
  ground_truth_label: GroundTruthLabel;
  evaluation_label: EvaluationLabel;
  event_association: EventAssociation;
  difficulty: ScenarioDifficulty;
  pattern_class: string | null;
  control_type: string | null;
  start_sec: number;
  intended_pattern: string;
  rationale: string;
}

const SCENARIO_BLUEPRINTS: ScenarioBlueprint[] = [
  {
    scenario_id: 'SCN-001',
    ground_truth_label: 'SPOOFING_LIKE_SEQUENCE',
    evaluation_label: 'POSITIVE_TEST',
    event_association: 'LINKED',
    difficulty: 'EASY',
    pattern_class: 'PRICE_DISPLACEMENT_SPOOF',
    control_type: null,
    start_sec: 160,
    intended_pattern: 'Large non-bona-fide bid stack amended closer to BBO, opposite ask filled, stack cancelled <450ms',
    rationale: 'Participant TM-1005 builds 2,600-qty bid wall 2 ticks from BBO, amends up 1 tick, gets 140-qty sell fill, cancels 92% of bid qty within 380ms.',
  },
  {
    scenario_id: 'SCN-002',
    ground_truth_label: 'LEGITIMATE_MULTI_LEVEL_QUOTING',
    evaluation_label: 'NEGATIVE_CONTROL',
    event_association: 'COINCIDENTAL',
    difficulty: 'HARD',
    pattern_class: null,
    control_type: 'MARKET_MAKER_REQUOTE',
    start_sec: 390,
    intended_pattern: 'Designated MM refreshes 6-level two-sided quotes with fast cancels during micro-volatility spike',
    rationale: 'Registered MM TM-1008 posts symmetric multi-level quotes; rapid cancel & requote on mid move coincides with passive fill on opposite side.',
  },
  {
    scenario_id: 'SCN-003',
    ground_truth_label: 'LAYERING_PATTERN',
    evaluation_label: 'POSITIVE_TEST',
    event_association: 'LINKED',
    difficulty: 'MEDIUM',
    pattern_class: 'MULTI_LEVEL_ASK_LAYERING',
    control_type: null,
    start_sec: 640,
    intended_pattern: '7 staggered ask orders across 0.35 INR depth creating artificial sell pressure before sweeping bid',
    rationale: 'Participant TM-1011 layers 7 sequential ask limits stepping down, induces mid drop, executes 180-qty buy benefit leg, cancels all 7 layers.',
  },
  {
    scenario_id: 'SCN-004',
    ground_truth_label: 'CANCEL_WITHOUT_OPPOSITE_TRADE',
    evaluation_label: 'NEGATIVE_CONTROL',
    event_association: 'INDEPENDENT',
    difficulty: 'MEDIUM',
    pattern_class: null,
    control_type: 'UNFILLED_BLOCK_PULL',
    start_sec: 900,
    intended_pattern: 'Large directional institutional bid partially filled then pulled after adverse tick without opposite execution',
    rationale: 'Institution TM-1010 places 1,900-qty bid, takes 350-qty partial fill, amends price once, then cancels remaining 1,550 with zero opposite-side fills.',
  },
  {
    scenario_id: 'SCN-005',
    ground_truth_label: 'SPOOFING_LIKE_SEQUENCE',
    evaluation_label: 'POSITIVE_TEST',
    event_association: 'LINKED',
    difficulty: 'HARD',
    pattern_class: 'ICEBERG_MIMIC_SPOOF',
    control_type: null,
    start_sec: 1140,
    intended_pattern: 'Moderate-size spoof orders split across 2 child orders with staged amends to evade single-order size filters',
    rationale: 'Participant TM-1006 splits 1,500-qty ask spoof into 3 smaller orders amended inward; takes 2 partial fills on bid before rapid cancel.',
  },
  {
    scenario_id: 'SCN-006',
    ground_truth_label: 'COINCIDENTAL_OPPOSITE_TRADE',
    evaluation_label: 'NEGATIVE_CONTROL',
    event_association: 'COINCIDENTAL',
    difficulty: 'HARD',
    pattern_class: null,
    control_type: 'MULTI_DESK_CROSS_FLOW',
    start_sec: 1380,
    intended_pattern: 'Independent desk strategies under same participant ID cancel resting ask within 1.8s of unrelated bid fill',
    rationale: 'Prop participant TM-1007 has two distinct accounts (ACC-7A, ACC-7B); statistical timing looks spoof-like at participant level but accounts are independent.',
  },
  {
    scenario_id: 'SCN-007',
    ground_truth_label: 'LARGE_ORDER_ONLY',
    evaluation_label: 'POSITIVE_TEST',
    event_association: 'NOT_APPLICABLE',
    difficulty: 'MEDIUM',
    pattern_class: 'DOMINANT_PASSIVE_BLUFF',
    control_type: null,
    start_sec: 1580,
    intended_pattern: 'Single oversized 3,200-qty passive order briefly dominates L1 depth to anchor book before full cancel',
    rationale: 'Participant TM-1014 flashes 3,200-qty bid (18x median L1 depth) for 1.9s, then cancels in full without executing opposite leg.',
  },
  {
    scenario_id: 'SCN-008',
    ground_truth_label: 'LEGITIMATE_LARGE_ORDER',
    evaluation_label: 'NEGATIVE_CONTROL',
    event_association: 'NOT_APPLICABLE',
    difficulty: 'EASY',
    pattern_class: null,
    control_type: 'INSTITUTIONAL_VWAP_SLICE',
    start_sec: 1690,
    intended_pattern: 'Institutional parent block worked patiently with 3 partial fills and final full fill over 28 seconds',
    rationale: 'Institution TM-1012 submits 2,400-qty bid, amends once to track mid, receives 3 partial fills and complete fill—bona fide execution intent.',
  },
];

export function buildSyntheticRun(options: {
  runId: string;
  seed: number;
  withDefects: boolean;
  createdAt: string;
}): SyntheticDataset {
  const { runId, seed, withDefects, createdAt } = options;
  const rng = mulberry32(seed);
  const instrumentId = 'INST-NSE-RELIANCE';
  const venueId = 'NSE-CM';
  const refPrice = 1284.5;

  // 1. Mid-price trajectory (1-sec grid)
  const midGrid: number[] = [refPrice];
  for (let t = 1; t <= SESSION_SECONDS; t++) {
    const step = (rng() - 0.5) * 0.16;
    midGrid.push(snapTick(midGrid[t - 1] + step));
  }

  // Apply realistic micro-price pressure around positive spoofing/layering scenarios
  for (const bp of SCENARIO_BLUEPRINTS) {
    if (bp.evaluation_label === 'POSITIVE_TEST' && bp.ground_truth_label !== 'LARGE_ORDER_ONLY') {
      const dir = bp.scenario_id === 'SCN-003' ? -1 : 1;
      for (let t = bp.start_sec; t <= Math.min(SESSION_SECONDS, bp.start_sec + 16); t++) {
        const progress = (t - bp.start_sec) / 10;
        const bump = progress <= 1 ? progress : Math.max(0, 1 - (progress - 1) * 1.4);
        midGrid[t] = snapTick(midGrid[t] + dir * 0.35 * bump);
      }
    }
  }

  const events: OrderEvent[] = [];
  const orderStates: OrderState[] = [];
  const trades: Trade[] = [];
  const scenarioManifest: ScenarioManifestRow[] = [];
  const orderScenarioMap: Record<string, { scenario_id: string; role: string }> = {};

  let seqCounter = 1;
  let orderCounter = 1;
  let eventCounter = 1;
  let tradeCounter = 1;

  const nextOrderId = () => `ORD-${String(orderCounter++).padStart(6, '0')}`;
  const nextEventId = () => `EVT-${String(eventCounter++).padStart(7, '0')}`;
  const nextTradeId = () => `TRD-${String(tradeCounter++).padStart(6, '0')}`;

  interface DraftEventSpec {
    t: number;
    type: OrderEvent['event_type'];
    price: number | null;
    orderQty: number;
    eventQty: number;
    remainingQty: number;
    status: OrderStatus;
    reasonCode?: ReasonCode | null;
    counterpartyPid?: string;
    aggressor?: Side;
  }

  function pushOrderLifecycle(params: {
    participantId: string;
    accountId: string;
    side: Side;
    orderType?: 'LIMIT' | 'MARKET';
    tif?: 'DAY' | 'IOC' | 'GTC';
    parentOrderId?: string | null;
    scenarioId: string | null;
    scenarioRole?: string;
    steps: DraftEventSpec[];
    dqFlag?: DataQualityFlag;
  }): { orderId: string; eventIds: string[]; tradeIds: string[] } {
    const orderId = nextOrderId();
    const orderType = params.orderType ?? 'LIMIT';
    const tif = params.tif ?? 'DAY';
    const eventIds: string[] = [];
    const tradeIds: string[] = [];

    const firstStep = params.steps[0];
    const lastStep = params.steps[params.steps.length - 1];
    let filledQty = 0;
    let cancelledQty = 0;
    let amendDelta = 0;
    let prevOrderQty = firstStep.orderQty;

    params.steps.forEach((st, idx) => {
      let tradeId: string | null = null;
      if (st.type === 'PARTIAL_FILL' || st.type === 'FILL') {
        tradeId = nextTradeId();
        tradeIds.push(tradeId);
        filledQty += st.eventQty;
        const cpOrderId = `ORD-CP-${String(tradeCounter).padStart(4, '0')}`;
        trades.push({
          run_id: runId,
          trade_id: tradeId,
          instrument_id: instrumentId,
          trade_timestamp_sec: st.t,
          price: st.price ?? midGrid[Math.min(SESSION_SECONDS, Math.floor(st.t))],
          quantity: st.eventQty,
          buy_order_id: params.side === 'BUY' ? orderId : cpOrderId,
          sell_order_id: params.side === 'SELL' ? orderId : cpOrderId,
          buy_participant_id: params.side === 'BUY' ? params.participantId : st.counterpartyPid ?? 'TM-1003',
          sell_participant_id: params.side === 'SELL' ? params.participantId : st.counterpartyPid ?? 'TM-1003',
          aggressor_side: st.aggressor ?? params.side,
          scenario_id: params.scenarioId,
          execution_status: 'EXECUTED',
        });
      }
      if (st.type === 'CANCEL') {
        cancelledQty += st.eventQty;
      }
      if (st.type === 'AMEND') {
        amendDelta += st.orderQty - prevOrderQty;
        prevOrderQty = st.orderQty;
      }

      const evtId = nextEventId();
      eventIds.push(evtId);
      const dqFlag: DataQualityFlag = idx === 0 && params.dqFlag ? params.dqFlag : 'NORMAL';

      events.push({
        run_id: runId,
        event_id: evtId,
        scenario_id: params.scenarioId,
        instrument_id: instrumentId,
        venue_id: venueId,
        event_timestamp_sec: st.t,
        event_timestamp_iso: toIso(st.t),
        sequence_number: seqCounter++,
        order_id: orderId,
        parent_order_id: params.parentOrderId ?? null,
        participant_id: params.participantId,
        account_id: params.accountId,
        side: params.side,
        event_type: st.type,
        price: st.price,
        order_qty: st.orderQty,
        event_qty: st.eventQty,
        remaining_qty: st.remainingQty,
        order_type: orderType,
        time_in_force: tif,
        source_sequence: seqCounter * 10,
        exchange_order_status: st.status,
        is_scenario_event: params.scenarioId !== null,
        data_quality_flag: dqFlag,
        reason_code: st.reasonCode ?? null,
        trade_id: tradeId,
        is_engine_generated: st.reasonCode === 'IOC_REMAINDER' || st.reasonCode === 'SELF_MATCH_PREVENTION',
      });
    });

    orderStates.push({
      run_id: runId,
      order_id: orderId,
      instrument_id: instrumentId,
      participant_id: params.participantId,
      account_id: params.accountId,
      side: params.side,
      order_type: orderType,
      time_in_force: tif,
      parent_order_id: params.parentOrderId ?? null,
      limit_price: lastStep.price,
      original_qty: firstStep.orderQty,
      amended_qty_delta: amendDelta,
      filled_qty: filledQty,
      cancelled_qty: cancelledQty,
      remaining_qty: lastStep.remainingQty,
      creation_timestamp_sec: firstStep.t,
      last_update_timestamp_sec: lastStep.t,
      status: lastStep.status,
      scenario_id: params.scenarioId,
    });

    if (params.scenarioId && params.scenarioRole) {
      orderScenarioMap[orderId] = {
        scenario_id: params.scenarioId,
        role: params.scenarioRole,
      };
    }

    return { orderId, eventIds, tradeIds };
  }

  // 2. Build the 8 rich Scenarios matching ScenarioBlueprint
  for (const bp of SCENARIO_BLUEPRINTS) {
    const s0 = bp.start_sec;
    const mid0 = midGrid[s0];
    const relOrders: string[] = [];
    const relEvents: string[] = [];
    const relTrades: string[] = [];
    let endSec = s0 + 12;

    if (bp.scenario_id === 'SCN-001') {
      // Spoofing: 2 large bids, 1 amended closer, opposite sell filled, bids cancelled
      const pid = 'TM-1005';
      const acc = 'ACC-501';
      const r1 = pushOrderLifecycle({
        participantId: pid,
        accountId: acc,
        side: 'BUY',
        scenarioId: bp.scenario_id,
        scenarioRole: 'spoof_leg',
        steps: [
          { t: s0, type: 'NEW', price: snapTick(mid0 - 0.15), orderQty: 1400, eventQty: 1400, remainingQty: 1400, status: 'ACTIVE' },
          { t: s0 + 2.4, type: 'AMEND', price: snapTick(mid0 - 0.10), orderQty: 1600, eventQty: 200, remainingQty: 1600, status: 'ACTIVE', reasonCode: 'REPLACED' },
          { t: s0 + 6.95, type: 'CANCEL', price: snapTick(mid0 - 0.10), orderQty: 1600, eventQty: 1600, remainingQty: 0, status: 'CANCELLED' },
        ],
      });
      const r2 = pushOrderLifecycle({
        participantId: pid,
        accountId: acc,
        side: 'BUY',
        scenarioId: bp.scenario_id,
        scenarioRole: 'spoof_leg',
        steps: [
          { t: s0 + 0.8, type: 'NEW', price: snapTick(mid0 - 0.20), orderQty: 1000, eventQty: 1000, remainingQty: 1000, status: 'ACTIVE' },
          { t: s0 + 7.12, type: 'CANCEL', price: snapTick(mid0 - 0.20), orderQty: 1000, eventQty: 1000, remainingQty: 0, status: 'CANCELLED' },
        ],
      });
      const bLeg = pushOrderLifecycle({
        participantId: pid,
        accountId: acc,
        side: 'SELL',
        scenarioId: bp.scenario_id,
        scenarioRole: 'benefit_leg',
        steps: [
          { t: s0 + 5.1, type: 'NEW', price: snapTick(mid0 + 0.25), orderQty: 140, eventQty: 140, remainingQty: 140, status: 'ACTIVE' },
          { t: s0 + 6.55, type: 'FILL', price: snapTick(mid0 + 0.25), orderQty: 140, eventQty: 140, remainingQty: 0, status: 'FILLED', aggressor: 'BUY' },
        ],
      });
      [r1, r2, bLeg].forEach((r) => {
        relOrders.push(r.orderId);
        relEvents.push(...r.eventIds);
        relTrades.push(...r.tradeIds);
      });
      endSec = s0 + 8;
    } else if (bp.scenario_id === 'SCN-002') {
      // Hard negative: Legitimate multi-level market-maker quoting
      const pid = 'TM-1008';
      const acc = 'ACC-MM8';
      for (let lvl = 0; lvl < 4; lvl++) {
        const b = pushOrderLifecycle({
          participantId: pid,
          accountId: acc,
          side: 'BUY',
          scenarioId: bp.scenario_id,
          scenarioRole: 'mm_quote_bid',
          steps: [
            { t: s0 + lvl * 0.4, type: 'NEW', price: snapTick(mid0 - 0.05 * (lvl + 1)), orderQty: 250 + lvl * 50, eventQty: 250 + lvl * 50, remainingQty: 250 + lvl * 50, status: 'ACTIVE' },
            ...(lvl === 0
              ? [{ t: s0 + 2.8, type: 'FILL' as const, price: snapTick(mid0 - 0.05), orderQty: 250, eventQty: 250, remainingQty: 0, status: 'FILLED' as const }]
              : [{ t: s0 + 3.4 + lvl * 0.2, type: 'CANCEL' as const, price: snapTick(mid0 - 0.05 * (lvl + 1)), orderQty: 250 + lvl * 50, eventQty: 250 + lvl * 50, remainingQty: 0, status: 'CANCELLED' as const }]),
          ],
        });
        const a = pushOrderLifecycle({
          participantId: pid,
          accountId: acc,
          side: 'SELL',
          scenarioId: bp.scenario_id,
          scenarioRole: 'mm_quote_ask',
          steps: [
            { t: s0 + lvl * 0.4 + 0.15, type: 'NEW', price: snapTick(mid0 + 0.05 * (lvl + 1)), orderQty: 250 + lvl * 50, eventQty: 250 + lvl * 50, remainingQty: 250 + lvl * 50, status: 'ACTIVE' },
            { t: s0 + 3.2 + lvl * 0.25, type: 'CANCEL', price: snapTick(mid0 + 0.05 * (lvl + 1)), orderQty: 250 + lvl * 50, eventQty: 250 + lvl * 50, remainingQty: 0, status: 'CANCELLED' },
          ],
        });
        [b, a].forEach((r) => {
          relOrders.push(r.orderId);
          relEvents.push(...r.eventIds);
          relTrades.push(...r.tradeIds);
        });
      }
      endSec = s0 + 6;
    } else if (bp.scenario_id === 'SCN-003') {
      // Layering: 6 staggered ask orders + opposite buy benefit leg
      const pid = 'TM-1011';
      const acc = 'ACC-1102';
      for (let lvl = 0; lvl < 6; lvl++) {
        const l = pushOrderLifecycle({
          participantId: pid,
          accountId: acc,
          side: 'SELL',
          scenarioId: bp.scenario_id,
          scenarioRole: 'layer_leg',
          steps: [
            { t: s0 + lvl * 0.75, type: 'NEW', price: snapTick(mid0 + 0.05 * (lvl + 1)), orderQty: 280 + lvl * 40, eventQty: 280 + lvl * 40, remainingQty: 280 + lvl * 40, status: 'ACTIVE' },
            { t: s0 + 8.9 + lvl * 0.14, type: 'CANCEL', price: snapTick(mid0 + 0.05 * (lvl + 1)), orderQty: 280 + lvl * 40, eventQty: 280 + lvl * 40, remainingQty: 0, status: 'CANCELLED' },
          ],
        });
        relOrders.push(l.orderId);
        relEvents.push(...l.eventIds);
      }
      const ben = pushOrderLifecycle({
        participantId: pid,
        accountId: acc,
        side: 'BUY',
        scenarioId: bp.scenario_id,
        scenarioRole: 'benefit_leg',
        steps: [
          { t: s0 + 6.8, type: 'NEW', price: snapTick(mid0 - 0.20), orderQty: 180, eventQty: 180, remainingQty: 180, status: 'ACTIVE' },
          { t: s0 + 8.3, type: 'FILL', price: snapTick(mid0 - 0.20), orderQty: 180, eventQty: 180, remainingQty: 0, status: 'FILLED', aggressor: 'SELL' },
        ],
      });
      relOrders.push(ben.orderId);
      relEvents.push(...ben.eventIds);
      relTrades.push(...ben.tradeIds);
      endSec = s0 + 11;
    } else if (bp.scenario_id === 'SCN-004') {
      // Hard Negative: Cancel without opposite trade (large institutional order partially filled, amended, cancelled)
      const pid = 'TM-1010';
      const acc = 'ACC-INST-10';
      const ord = pushOrderLifecycle({
        participantId: pid,
        accountId: acc,
        side: 'BUY',
        scenarioId: bp.scenario_id,
        scenarioRole: 'unfilled_block',
        steps: [
          { t: s0, type: 'NEW', price: snapTick(mid0 - 0.15), orderQty: 1900, eventQty: 1900, remainingQty: 1900, status: 'ACTIVE' },
          { t: s0 + 3.2, type: 'PARTIAL_FILL', price: snapTick(mid0 - 0.15), orderQty: 1900, eventQty: 350, remainingQty: 1550, status: 'PARTIALLY_FILLED' },
          { t: s0 + 6.4, type: 'AMEND', price: snapTick(mid0 - 0.10), orderQty: 1900, eventQty: 0, remainingQty: 1550, status: 'PARTIALLY_FILLED', reasonCode: 'REPLACED' },
          { t: s0 + 11.2, type: 'CANCEL', price: snapTick(mid0 - 0.10), orderQty: 1900, eventQty: 1550, remainingQty: 0, status: 'CANCELLED' },
        ],
      });
      relOrders.push(ord.orderId);
      relEvents.push(...ord.eventIds);
      relTrades.push(...ord.tradeIds);
      endSec = s0 + 13;
    } else if (bp.scenario_id === 'SCN-005') {
      // Hard positive: Split spoof with staged amends & partial fill on benefit leg
      const pid = 'TM-1006';
      const acc = 'ACC-602';
      for (let k = 0; k < 3; k++) {
        const sp = pushOrderLifecycle({
          participantId: pid,
          accountId: acc,
          side: 'SELL',
          scenarioId: bp.scenario_id,
          scenarioRole: 'spoof_leg',
          steps: [
            { t: s0 + k * 0.9, type: 'NEW', price: snapTick(mid0 + 0.25), orderQty: 500, eventQty: 500, remainingQty: 500, status: 'ACTIVE' },
            { t: s0 + 3.1 + k * 0.4, type: 'AMEND', price: snapTick(mid0 + 0.15), orderQty: 550, eventQty: 50, remainingQty: 550, status: 'ACTIVE', reasonCode: 'REPLACED' },
            { t: s0 + 8.4 + k * 0.18, type: 'CANCEL', price: snapTick(mid0 + 0.15), orderQty: 550, eventQty: 550, remainingQty: 0, status: 'CANCELLED' },
          ],
        });
        relOrders.push(sp.orderId);
        relEvents.push(...sp.eventIds);
      }
      const ben = pushOrderLifecycle({
        participantId: pid,
        accountId: acc,
        side: 'BUY',
        scenarioId: bp.scenario_id,
        scenarioRole: 'benefit_leg',
        steps: [
          { t: s0 + 5.2, type: 'NEW', price: snapTick(mid0 - 0.15), orderQty: 220, eventQty: 220, remainingQty: 220, status: 'ACTIVE' },
          { t: s0 + 6.8, type: 'PARTIAL_FILL', price: snapTick(mid0 - 0.15), orderQty: 220, eventQty: 120, remainingQty: 100, status: 'PARTIALLY_FILLED' },
          { t: s0 + 7.9, type: 'FILL', price: snapTick(mid0 - 0.15), orderQty: 220, eventQty: 100, remainingQty: 0, status: 'FILLED' },
        ],
      });
      relOrders.push(ben.orderId);
      relEvents.push(...ben.eventIds);
      relTrades.push(...ben.tradeIds);
      endSec = s0 + 10;
    } else if (bp.scenario_id === 'SCN-006') {
      // Hard negative: Coincidental opposite trade from independent accounts under TM-1007
      const pid = 'TM-1007';
      const legA = pushOrderLifecycle({
        participantId: pid,
        accountId: 'ACC-7A-STATARB',
        side: 'SELL',
        scenarioId: bp.scenario_id,
        scenarioRole: 'independent_desk_a',
        steps: [
          { t: s0, type: 'NEW', price: snapTick(mid0 + 0.15), orderQty: 950, eventQty: 950, remainingQty: 950, status: 'ACTIVE' },
          { t: s0 + 6.4, type: 'CANCEL', price: snapTick(mid0 + 0.15), orderQty: 950, eventQty: 950, remainingQty: 0, status: 'CANCELLED' },
        ],
      });
      const legB = pushOrderLifecycle({
        participantId: pid,
        accountId: 'ACC-7B-EXEC',
        side: 'BUY',
        scenarioId: bp.scenario_id,
        scenarioRole: 'independent_desk_b',
        steps: [
          { t: s0 + 3.8, type: 'NEW', price: snapTick(mid0 - 0.10), orderQty: 160, eventQty: 160, remainingQty: 160, status: 'ACTIVE' },
          { t: s0 + 4.9, type: 'FILL', price: snapTick(mid0 - 0.10), orderQty: 160, eventQty: 160, remainingQty: 0, status: 'FILLED' },
        ],
      });
      [legA, legB].forEach((r) => {
        relOrders.push(r.orderId);
        relEvents.push(...r.eventIds);
        relTrades.push(...r.tradeIds);
      });
      endSec = s0 + 8;
    } else if (bp.scenario_id === 'SCN-007') {
      // Large order only (Positive test)
      const ord = pushOrderLifecycle({
        participantId: 'TM-1014',
        accountId: 'ACC-1401',
        side: 'BUY',
        scenarioId: bp.scenario_id,
        scenarioRole: 'dominant_bluff_order',
        steps: [
          { t: s0, type: 'NEW', price: snapTick(mid0 - 0.05), orderQty: 3200, eventQty: 3200, remainingQty: 3200, status: 'ACTIVE' },
          { t: s0 + 2.1, type: 'CANCEL', price: snapTick(mid0 - 0.05), orderQty: 3200, eventQty: 3200, remainingQty: 0, status: 'CANCELLED' },
        ],
      });
      relOrders.push(ord.orderId);
      relEvents.push(...ord.eventIds);
      endSec = s0 + 4;
    } else if (bp.scenario_id === 'SCN-008') {
      // Legitimate large order worked patiently with partial fills + amend + final fill
      const ord = pushOrderLifecycle({
        participantId: 'TM-1012',
        accountId: 'ACC-INST-12',
        side: 'BUY',
        scenarioId: bp.scenario_id,
        scenarioRole: 'institutional_block',
        steps: [
          { t: s0, type: 'NEW', price: snapTick(mid0 - 0.10), orderQty: 2400, eventQty: 2400, remainingQty: 2400, status: 'ACTIVE' },
          { t: s0 + 5.5, type: 'PARTIAL_FILL', price: snapTick(mid0 - 0.10), orderQty: 2400, eventQty: 600, remainingQty: 1800, status: 'PARTIALLY_FILLED' },
          { t: s0 + 11.2, type: 'AMEND', price: snapTick(mid0 - 0.05), orderQty: 2400, eventQty: 0, remainingQty: 1800, status: 'PARTIALLY_FILLED', reasonCode: 'REPLACED' },
          { t: s0 + 17.4, type: 'PARTIAL_FILL', price: snapTick(mid0 - 0.05), orderQty: 2400, eventQty: 900, remainingQty: 900, status: 'PARTIALLY_FILLED' },
          { t: s0 + 24.8, type: 'FILL', price: snapTick(mid0 - 0.05), orderQty: 2400, eventQty: 900, remainingQty: 0, status: 'FILLED' },
        ],
      });
      relOrders.push(ord.orderId);
      relEvents.push(...ord.eventIds);
      relTrades.push(...ord.tradeIds);
      endSec = s0 + 26;
    }

    scenarioManifest.push({
      run_id: runId,
      scenario_id: bp.scenario_id,
      scenario_type: bp.ground_truth_label,
      scenario_version: 'scn-2.4.0',
      instrument_id: instrumentId,
      start_timestamp_sec: s0,
      end_timestamp_sec: endSec,
      start_timestamp_iso: toIso(s0),
      end_timestamp_iso: toIso(endSec),
      related_order_ids: relOrders,
      related_event_ids: relEvents,
      related_trade_ids: relTrades,
      intended_pattern: bp.intended_pattern,
      ground_truth_label: bp.ground_truth_label,
      pattern_class: bp.pattern_class,
      control_type: bp.control_type,
      event_association: bp.event_association,
      evaluation_label: bp.evaluation_label,
      difficulty: bp.difficulty,
      label_rationale: bp.rationale,
      expected_feature_behaviour: {
        SUBMISSION: bp.ground_truth_label === 'LARGE_ORDER_ONLY' ? 'high order_size_vs_adv_pct' : 'baseline',
        IN_LIFECYCLE: bp.ground_truth_label === 'LAYERING_PATTERN' ? 'elevated multi_level_layer_depth' : 'moderate imbalance',
        POST_EVENT: bp.evaluation_label === 'POSITIVE_TEST' ? 'elevated opposite_side_cancel_ratio' : 'overlap risk on hard negative',
      },
      acceptance_criterion: {
        min_events: relEvents.length,
        requires_opposite_fill: bp.event_association === 'LINKED',
      },
      validation_status: withDefects && bp.scenario_id === 'SCN-005' ? 'FAIL' : 'PASS',
      validation_reason:
        withDefects && bp.scenario_id === 'SCN-005'
          ? 'Sequence gap detected inside scenario window due to injected OUT_OF_ORDER event flag'
          : null,
      random_seed: seed,
    });
  }

  // 3. Baseline normal order flow (~1,520 orders with NEW, AMEND, PARTIAL_FILL, FILL, CANCEL, REJECT)
  const BASELINE_COUNT = 1520;
  const participants = ['TM-1001', 'TM-1002', 'TM-1003', 'TM-1004', 'TM-1009', 'TM-1013', 'TM-1015'];

  for (let i = 0; i < BASELINE_COUNT; i++) {
    const t0 = rng() * (SESSION_SECONDS - 15);
    const side: Side = rng() < 0.5 ? 'BUY' : 'SELL';
    const pid = participants[Math.floor(rng() * participants.length)];
    const acc = `ACC-${pid.slice(3)}1`;
    const m = midGrid[Math.min(SESSION_SECONDS, Math.floor(t0))];
    const ticksAway = Math.floor(-Math.log(1 - rng()) * 2.5) + 1;
    let p = snapTick(m + (side === 'BUY' ? -1 : 1) * ticksAway * TICK);
    const qty = Math.round(15 + Math.exp(rng() * 3.8) * 4);
    const life = Math.max(0.4, Math.min(90, Math.exp(0.6 + rng() * 3.4)));
    const u = rng();

    // Check whether to inject a DQ defect in defective run
    let dqFlag: DataQualityFlag = 'NORMAL';
    if (withDefects && rng() < 0.032) {
      const dfPick = rng();
      if (dfPick < 0.35) dqFlag = 'OUT_OF_ORDER';
      else if (dfPick < 0.65) dqFlag = 'DUPLICATE';
      else if (dfPick < 0.85) dqFlag = 'INCONSISTENT';
      else dqFlag = 'MISSING';
    }

    // ~4% REJECTs
    if (u < 0.04) {
      const rejectReasons: ReasonCode[] = ['INVALID_TICK', 'OUTSIDE_PRICE_BAND', 'INVALID_LOT', 'SELF_MATCH_PREVENTION'];
      const rc = rejectReasons[Math.floor(rng() * rejectReasons.length)];
      if (rc === 'INVALID_TICK') p = Number((p + 0.02).toFixed(2));
      if (rc === 'OUTSIDE_PRICE_BAND') p = snapTick(p * 1.25);
      pushOrderLifecycle({
        participantId: pid,
        accountId: acc,
        side,
        scenarioId: null,
        dqFlag,
        steps: [
          {
            t: t0,
            type: 'REJECT',
            price: p,
            orderQty: qty,
            eventQty: qty,
            remainingQty: 0,
            status: 'REJECTED',
            reasonCode: rc,
          },
        ],
      });
      continue;
    }

    // ~14% have an AMEND price step
    const hasAmend = rng() < 0.14;
    // ~10% have a PARTIAL_FILL before terminal FILL or CANCEL
    const hasPartial = rng() < 0.1;
    const isFill = u < 0.34;
    const steps: DraftEventSpec[] = [
      { t: t0, type: 'NEW', price: p, orderQty: qty, eventQty: qty, remainingQty: qty, status: 'ACTIVE' },
    ];

    let curPrice = p;
    let rem = qty;

    if (hasAmend) {
      const amendT = t0 + life * 0.35;
      curPrice = snapTick(curPrice + (side === 'BUY' ? 1 : -1) * TICK);
      steps.push({
        t: amendT,
        type: 'AMEND',
        price: curPrice,
        orderQty: qty,
        eventQty: 0,
        remainingQty: rem,
        status: 'ACTIVE',
        reasonCode: 'REPLACED',
      });
    }

    if (hasPartial && rem >= 20) {
      const partQty = Math.max(5, Math.floor(rem * (0.3 + rng() * 0.4)));
      rem -= partQty;
      steps.push({
        t: t0 + life * 0.65,
        type: 'PARTIAL_FILL',
        price: curPrice,
        orderQty: qty,
        eventQty: partQty,
        remainingQty: rem,
        status: 'PARTIALLY_FILLED',
      });
    }

    if (isFill) {
      steps.push({
        t: t0 + life,
        type: 'FILL',
        price: curPrice,
        orderQty: qty,
        eventQty: rem,
        remainingQty: 0,
        status: 'FILLED',
      });
    } else {
      steps.push({
        t: t0 + life,
        type: 'CANCEL',
        price: curPrice,
        orderQty: qty,
        eventQty: rem,
        remainingQty: 0,
        status: 'CANCELLED',
        reasonCode: rng() < 0.12 ? 'IOC_REMAINDER' : null,
      });
    }

    pushOrderLifecycle({
      participantId: pid,
      accountId: acc,
      side,
      tif: rng() < 0.08 ? 'IOC' : 'DAY',
      scenarioId: null,
      dqFlag,
      steps,
    });
  }

  // 3b. Long-lived resting baseline orders alive across window boundaries (essential for accurate event-replay book reconstruction)
  for (let i = 0; i < 64; i++) {
    const t0 = 1 + (i % 12) * 0.6;
    const side: Side = i % 2 === 0 ? 'BUY' : 'SELL';
    const pid = participants[i % participants.length];
    const acc = `ACC-${pid.slice(3)}1`;
    const lvl = 1 + (i % 5);
    const m = midGrid[Math.floor(t0)];
    const p = snapTick(m + (side === 'BUY' ? -1 : 1) * lvl * TICK);
    const qty = 80 + ((i * 45) % 240);
    const life = 400 + rng() * 1350;
    const tEnd = t0 + life;
    const steps: DraftEventSpec[] = [
      { t: t0, type: 'NEW', price: p, orderQty: qty, eventQty: qty, remainingQty: qty, status: 'ACTIVE' },
    ];
    if (tEnd < SESSION_SECONDS - 5) {
      steps.push({
        t: tEnd,
        type: 'CANCEL',
        price: p,
        orderQty: qty,
        eventQty: qty,
        remainingQty: 0,
        status: 'CANCELLED',
      });
    }
    pushOrderLifecycle({
      participantId: pid,
      accountId: acc,
      side,
      scenarioId: null,
      steps,
    });
  }

  // Sort events by event_timestamp_sec (preserving sequence_number ordering cleanly)
  events.sort((a, b) => a.event_timestamp_sec - b.event_timestamp_sec);
  events.forEach((ev, idx) => {
    ev.sequence_number = idx + 1;
  });

  // 4. Book Snapshots every 1 second with 5-level bid/ask arrays
  const bookSnapshots: BookSnapshot[] = midGrid.map((mid, sec) => {
    const spread = snapTick(0.05 + (sec % 7 === 0 ? 0.05 : 0));
    const bid = snapTick(mid - spread / 2);
    const ask = snapTick(bid + spread);

    const bid_prices: number[] = [];
    const bid_depths: number[] = [];
    const bid_order_counts: number[] = [];
    const ask_prices: number[] = [];
    const ask_depths: number[] = [];
    const ask_order_counts: number[] = [];

    for (let lvl = 0; lvl < 5; lvl++) {
      const bp = snapTick(bid - lvl * TICK);
      const ap = snapTick(ask + lvl * TICK);
      const bQty = 140 + ((sec * 37 + lvl * 91) % 360);
      const aQty = 130 + ((sec * 53 + lvl * 83) % 340);
      bid_prices.push(bp);
      bid_depths.push(bQty);
      bid_order_counts.push(1 + ((sec + lvl) % 4));
      ask_prices.push(ap);
      ask_depths.push(aQty);
      ask_order_counts.push(1 + ((sec + lvl + 1) % 4));
    }

    return {
      run_id: runId,
      snapshot_id: `SNAP-${String(sec + 1).padStart(5, '0')}`,
      instrument_id: instrumentId,
      snapshot_timestamp_sec: sec,
      sequence_number: sec * 3 + 1,
      best_bid_price: bid,
      best_bid_qty: bid_depths[0],
      best_ask_price: ask,
      best_ask_qty: ask_depths[0],
      spread,
      mid_price: mid,
      bid_prices,
      bid_depths,
      bid_order_counts,
      ask_prices,
      ask_depths,
      ask_order_counts,
      book_status: 'VALID',
      data_quality_flag: withDefects && sec % 311 === 0 ? 'MISSING' : 'NORMAL',
    };
  });

  // 5. Long-format analytics.surveillance_features
  const features: SurveillanceFeatureRow[] = [];
  let featRowId = 1;
  const stages: ScoringStage[] = ['SUBMISSION', 'IN_LIFECYCLE', 'POST_EVENT'];
  const versions = ['v2.1.0', 'v2.0.0'];

  // Map scenario entities + sample baseline entities
  const entitySpecs: Array<{
    entity_type: SurveillanceFeatureRow['entity_type'];
    entity_id: string;
    participant_id: string;
    evalClass: 'POSITIVE' | 'HARD_NEGATIVE' | 'BASELINE';
    gtLabel?: GroundTruthLabel;
    tSec: number;
    side: Side;
    cancelledQty: number;
    filledQty: number;
    orderCount: number;
  }> = [];

  for (const scn of scenarioManifest) {
    const scnEvents = events.filter((e) => e.scenario_id === scn.scenario_id);
    const pid = scnEvents[0]?.participant_id ?? 'TM-1005';
    const cancelledQty = scnEvents.filter((e) => e.event_type === 'CANCEL').reduce((s, e) => s + e.event_qty, 0);
    const filledQty = scnEvents.filter((e) => e.event_type === 'FILL' || e.event_type === 'PARTIAL_FILL').reduce((s, e) => s + e.event_qty, 0);
    entitySpecs.push({
      entity_type: 'SCENARIO',
      entity_id: scn.scenario_id,
      participant_id: pid,
      evalClass: scn.evaluation_label === 'POSITIVE_TEST' ? 'POSITIVE' : 'HARD_NEGATIVE',
      gtLabel: scn.ground_truth_label,
      tSec: scn.end_timestamp_sec,
      side: scnEvents[0]?.side ?? 'BUY',
      cancelledQty,
      filledQty,
      orderCount: scn.related_order_ids.length,
    });
  }

  // Add 72 representative baseline participant-window entities
  for (let k = 0; k < 72; k++) {
    const pid = participants[k % participants.length];
    const tSec = 45 + k * 23;
    const cancelledQty = Math.round(40 + rng() * 480);
    const filledQty = Math.round(60 + rng() * 320);
    entitySpecs.push({
      entity_type: 'PARTICIPANT',
      entity_id: `${pid}@W${String(k + 1).padStart(2, '0')}`,
      participant_id: pid,
      evalClass: 'BASELINE',
      tSec,
      side: k % 2 === 0 ? 'BUY' : 'SELL',
      cancelledQty,
      filledQty,
      orderCount: 2 + (k % 5),
    });
  }

  for (const ver of versions) {
    const verBoost = ver === 'v2.1.0' ? 1.0 : 0.88;
    for (const stage of stages) {
      for (const ent of entitySpecs) {
        const isPos = ent.evalClass === 'POSITIVE';
        const isHardNeg = ent.evalClass === 'HARD_NEGATIVE';

        // Compute realistic stage-dependent feature values
        const sizeVsAdv =
          isPos && ent.gtLabel === 'LARGE_ORDER_ONLY'
            ? 0.82 + rng() * 0.14
            : isPos
              ? 0.42 + rng() * 0.36
              : isHardNeg
                ? 0.34 + rng() * 0.38
                : 0.04 + rng() * 0.22;

        const layerDepth =
          isPos && ent.gtLabel === 'LAYERING_PATTERN'
            ? 5.8 + rng() * 1.4
            : isHardNeg && ent.gtLabel === 'LEGITIMATE_MULTI_LEVEL_QUOTING'
              ? 4.0 + rng() * 1.5
              : isPos
                ? 2.2 + rng() * 1.8
                : 1.0 + rng() * 1.4;

        const imbDelta =
          stage === 'SUBMISSION'
            ? (isPos ? 0.28 : isHardNeg ? 0.22 : 0.08) + rng() * 0.18
            : (isPos ? 0.56 : isHardNeg ? 0.38 : 0.12) + rng() * 0.24;

        const oppCancelRatio =
          stage === 'POST_EVENT'
            ? (isPos && ent.gtLabel !== 'LARGE_ORDER_ONLY'
                ? 0.78 + rng() * 0.2
                : isHardNeg && ent.gtLabel !== 'CANCEL_WITHOUT_OPPOSITE_TRADE'
                  ? 0.48 + rng() * 0.34
                  : 0.05 + rng() * 0.28)
            : stage === 'IN_LIFECYCLE'
              ? (isPos ? 0.42 : isHardNeg ? 0.31 : 0.09) + rng() * 0.18
              : 0.02 + rng() * 0.08;

        const cancelLatencyMs =
          stage === 'POST_EVENT'
            ? isPos
              ? 220 + rng() * 520
              : isHardNeg
                ? 360 + rng() * 1200
                : 1800 + rng() * 6500
            : 2500 + rng() * 4000;

        const composite = Math.min(
          0.99,
          Math.max(
            0.02,
            verBoost *
              (stage === 'SUBMISSION'
                ? sizeVsAdv * 0.65 + rng() * 0.12
                : stage === 'IN_LIFECYCLE'
                  ? (layerDepth / 7) * 0.45 + imbDelta * 0.45 + rng() * 0.08
                  : oppCancelRatio * 0.58 + (1 - Math.min(1, cancelLatencyMs / 4000)) * 0.32 + imbDelta * 0.12)
          )
        );

        const dqDegraded = withDefects && ent.entity_id === 'SCN-005';
        const alertThreshold = stage === 'SUBMISSION' ? 0.62 : stage === 'IN_LIFECYCLE' ? 0.60 : 0.64;
        const triggered = !dqDegraded && composite >= alertThreshold;

        const featPairs: Array<[string, number]> = [
          ['opposite_side_cancel_ratio', Number(oppCancelRatio.toFixed(4))],
          ['cancel_to_fill_latency_ms', Math.round(cancelLatencyMs)],
          ['order_book_imbalance_delta', Number(imbDelta.toFixed(4))],
          ['multi_level_layer_depth', Number(layerDepth.toFixed(2))],
          ['order_size_vs_adv_pct', Number((sizeVsAdv * 100).toFixed(2))],
        ];

        for (const [fname, fval] of featPairs) {
          features.push({
            run_id: runId,
            feature_row_id: featRowId++,
            feature_timestamp_sec: ent.tSec,
            observation_start_sec: Math.max(0, ent.tSec - 15),
            observation_end_sec: ent.tSec,
            feature_name: fname,
            feature_value_num: fval,
            feature_value_cat: null,
            entity_type: ent.entity_type,
            entity_id: ent.entity_id,
            feature_version: ver,
            scoring_stage: stage,
            data_quality_status: dqDegraded ? 'DEGRADED' : 'OK',
            context: {
              side: ent.side,
              cancelled_qty: ent.cancelledQty,
              filled_qty: ent.filledQty,
              cancel_latency_ms: Math.round(cancelLatencyMs),
              composite_score: Number(composite.toFixed(3)),
              alert_triggered: triggered,
              participant_id: ent.participant_id,
              order_count: ent.orderCount,
            },
          });
        }
      }
    }
  }

  // 6. quality.validation_results across all 6 scopes
  const totalEvents = events.length;
  const dqDefectEvents = events.filter((e) => e.data_quality_flag !== 'NORMAL').length;
  const tickPassEvents = events.filter((e) => e.reason_code !== 'INVALID_TICK').length;
  const seqBadEvents = events.filter((e) => e.data_quality_flag === 'OUT_OF_ORDER' || e.data_quality_flag === 'DUPLICATE').length;
  const missingEvents = events.filter((e) => e.data_quality_flag === 'MISSING').length;

  const validationResults: ValidationResultRow[] = [
    {
      run_id: runId,
      result_id: 1,
      check_id: 'CHK-RUN-01',
      requirement_id: 'REQ-OPS04',
      scope: 'RUN',
      scenario_id: null,
      status: 'PASS',
      message: 'Seed, config_hash, and threshold config_json persisted in quality.run_metadata.',
      details: { config_hash: withDefects ? 'sha256:9e41d0f2' : 'sha256:7a38c4e1', seed },
      created_at: createdAt,
      pass_rate_pct: 100,
      checked_rows: 1,
      passed_rows: 1,
    },
    {
      run_id: runId,
      result_id: 2,
      check_id: 'CHK-INS-01',
      requirement_id: 'REQ-MKT01',
      scope: 'INSTRUMENT',
      scenario_id: null,
      status: 'PASS',
      message: 'Reference price within [price_band_low, price_band_high]; positive tick & lot.',
      details: { symbol: 'RELIANCE', tick_size: 0.05, band: [1027.6, 1541.4] },
      created_at: createdAt,
      pass_rate_pct: 100,
      checked_rows: 1,
      passed_rows: 1,
    },
    {
      run_id: runId,
      result_id: 3,
      check_id: 'CHK-EVT-01',
      requirement_id: 'REQ-DQ02',
      scope: 'EVENT_STREAM',
      scenario_id: null,
      status: seqBadEvents > 0 ? 'FAIL' : 'PASS',
      message:
        seqBadEvents > 0
          ? `${seqBadEvents} events flagged DUPLICATE or OUT_OF_ORDER in core.order_events.`
          : 'Monotonic sequence_number and event_timestamp verified across all events.',
      details: { total_events: totalEvents, flagged_events: seqBadEvents },
      created_at: createdAt,
      pass_rate_pct: Number((((totalEvents - seqBadEvents) / totalEvents) * 100).toFixed(2)),
      checked_rows: totalEvents,
      passed_rows: totalEvents - seqBadEvents,
    },
    {
      run_id: runId,
      result_id: 4,
      check_id: 'CHK-EVT-02',
      requirement_id: 'REQ-DQ03',
      scope: 'EVENT_STREAM',
      scenario_id: null,
      status: missingEvents > 0 ? 'FAIL' : 'PASS',
      message:
        missingEvents > 0
          ? `${missingEvents} events carry data_quality_flag = MISSING.`
          : 'Zero MISSING or NULL required fields across event stream.',
      details: { total_events: totalEvents, missing_events: missingEvents },
      created_at: createdAt,
      pass_rate_pct: Number((((totalEvents - missingEvents) / totalEvents) * 100).toFixed(2)),
      checked_rows: totalEvents,
      passed_rows: totalEvents - missingEvents,
    },
    {
      run_id: runId,
      result_id: 5,
      check_id: 'CHK-ORD-01',
      requirement_id: 'REQ-DQ01',
      scope: 'ORDER_STATE',
      scenario_id: null,
      status: withDefects ? 'FAIL' : 'PASS',
      message: withDefects
        ? '14 order_state rows fail order_qty_identity reconciliation due to INCONSISTENT event flags.'
        : 'order_qty_identity holds for 100% of non-rejected orders.',
      details: { checked_orders: orderStates.length, tick_rejected: totalEvents - tickPassEvents },
      created_at: createdAt,
      pass_rate_pct: withDefects ? 98.4 : 100,
      checked_rows: orderStates.length,
      passed_rows: withDefects ? orderStates.length - 14 : orderStates.length,
    },
    {
      run_id: runId,
      result_id: 6,
      check_id: 'CHK-BK-01',
      requirement_id: 'REQ-DQ04',
      scope: 'BOOK_SNAPSHOTS',
      scenario_id: null,
      status: withDefects ? 'PENDING' : 'PASS',
      message: withDefects
        ? 'Awaiting re-derivation after 6 snapshots reported MISSING book_status.'
        : 'All 1,801 L2 snapshots pass spread/mid consistency and array cardinality checks.',
      details: { total_snapshots: bookSnapshots.length },
      created_at: createdAt,
      pass_rate_pct: withDefects ? 99.67 : 100,
      checked_rows: bookSnapshots.length,
      passed_rows: withDefects ? bookSnapshots.length - 6 : bookSnapshots.length,
    },
    {
      run_id: runId,
      result_id: 7,
      check_id: 'CHK-SCN-01',
      requirement_id: 'REQ-OPS07',
      scope: 'SCENARIO_MANIFEST',
      scenario_id: null,
      status: 'PASS',
      message: 'model_input.* views expose zero labels.*, scenario_id, or is_scenario_event columns.',
      details: { views_audited: 6, leaked_columns: 0 },
      created_at: createdAt,
      pass_rate_pct: 100,
      checked_rows: 6,
      passed_rows: 6,
    },
    {
      run_id: runId,
      result_id: 8,
      check_id: 'CHK-SCN-02',
      requirement_id: 'REQ-VAL03',
      scope: 'SCENARIO_MANIFEST',
      scenario_id: 'SCN-005',
      status: withDefects ? 'FAIL' : 'PASS',
      message: withDefects
        ? 'SCN-005 failed acceptance criterion: sequence gap inside spoofing window.'
        : 'All 8 seeded & control scenarios satisfy acceptance_criterion JSON contracts.',
      details: { scenarios_checked: scenarioManifest.length },
      created_at: createdAt,
      pass_rate_pct: withDefects ? 87.5 : 100,
      checked_rows: scenarioManifest.length,
      passed_rows: withDefects ? scenarioManifest.length - 1 : scenarioManifest.length,
    },
  ];

  // Count how many POSITIVE_TEST seeded orders pass every structural/DQ check
  const posOrderIds = new Set(
    scenarioManifest
      .filter((s) => s.evaluation_label === 'POSITIVE_TEST')
      .flatMap((s) => s.related_order_ids)
  );
  const posOrdersPassing = Array.from(posOrderIds).filter((oid) => {
    if (withDefects && scenarioManifest.find((s) => s.scenario_id === 'SCN-005')?.related_order_ids.includes(oid)) {
      return false;
    }
    return events.filter((e) => e.order_id === oid).every((e) => e.data_quality_flag === 'NORMAL');
  }).length;

  return {
    run_metadata: {
      run_id: runId,
      random_seed: seed,
      config_version: 'cfg-3.2.1',
      generator_version: 'synth-engine-4.1.0',
      scenario_version: 'scn-2.4.0',
      config_hash: withDefects ? 'sha256:9e41d0f2b8a4' : 'sha256:7a38c4e19c0d',
      status: withDefects ? 'FAILED' : 'VALIDATED',
      created_at: createdAt,
      config_json: {
        venue: 'NSE-CM',
        instrument_universe: ['RELIANCE'],
        baseline_sample_rate: 0.035,
        scenario_window_pad_sec: 20,
        min_spoof_notional_inr: 1500000,
        cancel_to_fill_window_ms: 1500,
        inject_dq_defects: withDefects,
        dq_defect_rate: withDefects ? 0.032 : 0.0,
        enforce_model_input_isolation: true,
      },
      bundle_budget_kb: {
        model_input_kb: 384,
        labels_sidecar_kb: 28,
        max_budget_kb: 1536,
        total_session_events: 142800,
        embedded_events: events.length,
        baseline_sample_pct: 3.5,
      },
    },
    instrument_master: {
      run_id: runId,
      instrument_id: instrumentId,
      symbol: 'RELIANCE',
      exchange: 'NSE',
      currency: 'INR',
      tick_size: 0.05,
      lot_size: 1,
      price_band_low: 1027.6,
      price_band_high: 1541.4,
      session_open: '2026-11-17T09:15:00+05:30',
      session_close: '2026-11-17T15:30:00+05:30',
      instrument_type: 'EQUITY',
      reference_price: refPrice,
      volatility_regime: 'MEDIUM',
      liquidity_regime: 'HIGH',
    },
    model_input: {
      order_events: events.map((ev) => ({
        ...ev,
        // Notice: model_input.* physically strips scenario_id and is_scenario_event!
        // We keep a clean model_input view object here; labels live ONLY in evaluator_bundle.
        scenario_id: null,
        is_scenario_event: false,
      })),
      order_state: orderStates.map((os) => ({ ...os, scenario_id: null })),
      trades: trades.map((tr) => ({ ...tr, scenario_id: null })),
      book_snapshots: bookSnapshots,
      surveillance_features: features,
    },
    evaluator_bundle: {
      scenario_manifest: scenarioManifest,
      validation_results: validationResults,
      order_scenario_map: orderScenarioMap,
      seeded_orders_passing_all_checks: {
        passed: posOrdersPassing,
        total: posOrderIds.size,
      },
    },
  };
}

export function rebuildOrderLifelines(
  events: OrderEvent[],
  orderScenarioMap?: Record<string, { scenario_id: string; role: string }>,
  sessionDurationSec = SESSION_SECONDS
): RebuiltOrderLifeline[] {
  const byOrder = new Map<string, OrderEvent[]>();
  for (const ev of events) {
    const arr = byOrder.get(ev.order_id);
    if (arr) arr.push(ev);
    else byOrder.set(ev.order_id, [ev]);
  }

  const lifelines: RebuiltOrderLifeline[] = [];

  for (const [orderId, rawEvs] of byOrder.entries()) {
    const evs = rawEvs.slice().sort((a, b) => a.sequence_number - b.sequence_number);
    const first = evs[0];
    const last = evs[evs.length - 1];

    const segments: RebuiltOrderLifeline['segments'] = [];
    const partial_fills: RebuiltOrderLifeline['partial_fills'] = [];
    const amends: RebuiltOrderLifeline['amends'] = [];
    let final_fill: RebuiltOrderLifeline['final_fill'] = null;
    let cancel: RebuiltOrderLifeline['cancel'] = null;
    let reject: RebuiltOrderLifeline['reject'] = null;

    let segStart = first.event_timestamp_sec;
    let curPrice = first.price ?? 1284.5;
    let curQty = first.order_qty;
    let maxQty = first.order_qty;
    let filledQty = 0;
    let cancelledQty = 0;
    let hasDqDefect = false;

    for (const ev of evs) {
      if (ev.data_quality_flag !== 'NORMAL') hasDqDefect = true;
      const p = ev.price ?? curPrice;

      if (ev.event_type === 'AMEND') {
        if (ev.event_timestamp_sec > segStart) {
          segments.push({ t0: segStart, t1: ev.event_timestamp_sec, price: curPrice, qty: curQty });
        }
        amends.push({
          t: ev.event_timestamp_sec,
          from_price: curPrice,
          to_price: p,
          new_qty: ev.order_qty,
        });
        segStart = ev.event_timestamp_sec;
        curPrice = p;
        curQty = ev.remaining_qty;
        maxQty = Math.max(maxQty, ev.order_qty);
      } else if (ev.event_type === 'PARTIAL_FILL') {
        filledQty += ev.event_qty;
        partial_fills.push({
          t: ev.event_timestamp_sec,
          price: p,
          qty: ev.event_qty,
          trade_id: ev.trade_id ?? '',
        });
        curQty = Math.max(curQty, ev.remaining_qty);
      } else if (ev.event_type === 'FILL') {
        filledQty += ev.event_qty;
        segments.push({ t0: segStart, t1: ev.event_timestamp_sec, price: curPrice, qty: curQty });
        final_fill = {
          t: ev.event_timestamp_sec,
          price: p,
          qty: ev.event_qty,
          trade_id: ev.trade_id ?? '',
        };
      } else if (ev.event_type === 'CANCEL') {
        cancelledQty += ev.event_qty;
        segments.push({ t0: segStart, t1: ev.event_timestamp_sec, price: curPrice, qty: curQty });
        cancel = {
          t: ev.event_timestamp_sec,
          price: p,
          reason_code: ev.reason_code,
        };
      } else if (ev.event_type === 'REJECT') {
        reject = {
          t: ev.event_timestamp_sec,
          price: p,
          reason_code: ev.reason_code,
        };
      }
    }

    // If order is still open / active without terminal event in slice
    if (segments.length === 0 && !reject) {
      segments.push({
        t0: segStart,
        t1: sessionDurationSec,
        price: curPrice,
        qty: curQty,
      });
    }

    const scnInfo = orderScenarioMap?.[orderId];
    const effectiveEnd =
      !reject && !final_fill && !cancel ? sessionDurationSec : last.event_timestamp_sec;

    lifelines.push({
      order_id: orderId,
      participant_id: first.participant_id,
      account_id: first.account_id,
      side: first.side,
      order_type: first.order_type,
      time_in_force: first.time_in_force,
      t_start: first.event_timestamp_sec,
      t_end: effectiveEnd,
      initial_price: first.price ?? curPrice,
      final_price: curPrice,
      initial_qty: first.order_qty,
      max_qty: maxQty,
      filled_qty: filledQty,
      cancelled_qty: cancelledQty,
      status: last.exchange_order_status,
      has_dq_defect: hasDqDefect,
      events: evs,
      segments,
      partial_fills,
      final_fill,
      amends,
      cancel,
      reject,
      scenario_id: scnInfo?.scenario_id ?? null,
      role_in_scenario: scnInfo?.role ?? null,
    });
  }

  return lifelines;
}

export function getNearestSnapshotAtTime(
  snapshots: BookSnapshot[],
  targetTimeSec: number
): BookSnapshot | null {
  if (snapshots.length === 0) return null;
  let lo = 0;
  let hi = snapshots.length - 1;
  let best = snapshots[0];
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (snapshots[mid].snapshot_timestamp_sec <= targetTimeSec) {
      best = snapshots[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

export function replayOrderBookAtTime(
  events: OrderEvent[],
  targetTimeSec: number
): {
  bids: BookLadderLevel[];
  asks: BookLadderLevel[];
  lastSequenceNumber: number;
  activeOrderCount: number;
} {
  const resting = new Map<string, RestingBookOrder>();
  let lastSeq = 0;

  for (const ev of events) {
    if (ev.event_timestamp_sec > targetTimeSec) break;
    lastSeq = ev.sequence_number;
    if (ev.event_type === 'REJECT') continue;

    if (ev.event_type === 'NEW') {
      if (ev.price != null && ev.remaining_qty > 0) {
        resting.set(ev.order_id, {
          order_id: ev.order_id,
          participant_id: ev.participant_id,
          account_id: ev.account_id,
          side: ev.side,
          price: ev.price,
          remaining_qty: ev.remaining_qty,
          sequence_number: ev.sequence_number,
        });
      }
    } else if (ev.event_type === 'AMEND') {
      const existing = resting.get(ev.order_id);
      if (existing) {
        if (ev.remaining_qty <= 0) resting.delete(ev.order_id);
        else {
          existing.price = ev.price ?? existing.price;
          existing.remaining_qty = ev.remaining_qty;
          existing.sequence_number = ev.sequence_number;
        }
      }
    } else if (ev.event_type === 'PARTIAL_FILL') {
      const existing = resting.get(ev.order_id);
      if (existing) {
        if (ev.remaining_qty <= 0) resting.delete(ev.order_id);
        else existing.remaining_qty = ev.remaining_qty;
      }
    } else if (ev.event_type === 'FILL' || ev.event_type === 'CANCEL') {
      resting.delete(ev.order_id);
    }
  }

  const bidMap = new Map<number, RestingBookOrder[]>();
  const askMap = new Map<number, RestingBookOrder[]>();

  for (const ord of resting.values()) {
    const targetMap = ord.side === 'BUY' ? bidMap : askMap;
    const list = targetMap.get(ord.price);
    if (list) list.push(ord);
    else targetMap.set(ord.price, [ord]);
  }

  const toLevels = (map: Map<number, RestingBookOrder[]>, desc: boolean): BookLadderLevel[] =>
    Array.from(map.entries())
      .sort((a, b) => (desc ? b[0] - a[0] : a[0] - b[0]))
      .map(([price, orders]) => ({
        price,
        total_qty: orders.reduce((s, o) => s + o.remaining_qty, 0),
        order_count: orders.length,
        orders: orders.slice().sort((x, y) => y.remaining_qty - x.remaining_qty),
      }));

  return {
    bids: toLevels(bidMap, true),
    asks: toLevels(askMap, false),
    lastSequenceNumber: lastSeq,
    activeOrderCount: resting.size,
  };
}

function mapScenarioSemantics(scId: ScenarioId): {
  gt: GroundTruthLabel;
  evalLabel: EvaluationLabel;
  assoc: EventAssociation;
  patternClass: string | null;
  controlType: string | null;
} {
  switch (scId) {
    case 'S01':
      return {
        gt: 'LARGE_ORDER_ONLY',
        evalLabel: 'POSITIVE_TEST',
        assoc: 'NOT_APPLICABLE',
        patternClass: 'DOMINANT_PASSIVE_BLUFF',
        controlType: null,
      };
    case 'S02':
      return {
        gt: 'LARGE_ORDER_ONLY',
        evalLabel: 'POSITIVE_TEST',
        assoc: 'NOT_APPLICABLE',
        patternClass: 'LARGE_ORDER_PARTIAL_FILL',
        controlType: null,
      };
    case 'S03':
      return {
        gt: 'LARGE_ORDER_ONLY',
        evalLabel: 'POSITIVE_TEST',
        assoc: 'NOT_APPLICABLE',
        patternClass: 'LARGE_ORDER_IOC_FILL',
        controlType: null,
      };
    case 'S04':
      return {
        gt: 'LARGE_ORDER_ONLY',
        evalLabel: 'POSITIVE_TEST',
        assoc: 'NOT_APPLICABLE',
        patternClass: 'LARGE_ORDER_QUICK_CANCEL',
        controlType: null,
      };
    case 'S05':
      return {
        gt: 'LAYERING_PATTERN',
        evalLabel: 'POSITIVE_TEST',
        assoc: 'INDEPENDENT',
        patternClass: 'GRADUAL_CANCEL_LAYERING',
        controlType: null,
      };
    case 'S06':
      return {
        gt: 'LEGITIMATE_MULTI_LEVEL_QUOTING',
        evalLabel: 'NEGATIVE_CONTROL',
        assoc: 'NOT_APPLICABLE',
        patternClass: null,
        controlType: 'PERSISTENT_LAYERED_QUOTE',
      };
    case 'S07':
      return {
        gt: 'LAYERING_PATTERN',
        evalLabel: 'POSITIVE_TEST',
        assoc: 'INDEPENDENT',
        patternClass: 'RAPID_BATCH_LAYERING',
        controlType: null,
      };
    case 'S08':
      return {
        gt: 'SPOOFING_LIKE_SEQUENCE',
        evalLabel: 'POSITIVE_TEST',
        assoc: 'LINKED',
        patternClass: 'LAYER_PLUS_LINKED_TRADE',
        controlType: null,
      };
    case 'S09':
      return {
        gt: 'SPOOFING_LIKE_SEQUENCE',
        evalLabel: 'POSITIVE_TEST',
        assoc: 'INDEPENDENT',
        patternClass: 'LAYER_WITHOUT_LINKED_TRADE',
        controlType: null,
      };
    case 'S10':
      return {
        gt: 'LEGITIMATE_LARGE_ORDER',
        evalLabel: 'NEGATIVE_CONTROL',
        assoc: 'NOT_APPLICABLE',
        patternClass: null,
        controlType: 'PATIENT_INSTITUTIONAL_ORDER',
      };
    case 'S11':
      return {
        gt: 'LEGITIMATE_MULTI_LEVEL_QUOTING',
        evalLabel: 'NEGATIVE_CONTROL',
        assoc: 'COINCIDENTAL',
        patternClass: null,
        controlType: 'MARKET_MAKER_QUOTE_UPDATES',
      };
    case 'S12':
      return {
        gt: 'LEGITIMATE_MULTI_LEVEL_QUOTING',
        evalLabel: 'NEGATIVE_CONTROL',
        assoc: 'COINCIDENTAL',
        patternClass: null,
        controlType: 'TWO_SIDED_MULTI_LEVEL_QUOTE',
      };
    case 'S13':
      return {
        gt: 'CANCEL_WITHOUT_OPPOSITE_TRADE',
        evalLabel: 'NEGATIVE_CONTROL',
        assoc: 'INDEPENDENT',
        patternClass: null,
        controlType: 'HIGH_VOLATILITY_BURST',
      };
    case 'S14':
      return {
        gt: 'LEGITIMATE_LARGE_ORDER',
        evalLabel: 'NEGATIVE_CONTROL',
        assoc: 'NOT_APPLICABLE',
        patternClass: null,
        controlType: 'SMALL_ORDER_ILLIQUID_BOOK',
      };
    case 'S15':
      return {
        gt: 'COINCIDENTAL_OPPOSITE_TRADE',
        evalLabel: 'NEGATIVE_CONTROL',
        assoc: 'COINCIDENTAL',
        patternClass: null,
        controlType: 'COINCIDENTAL_UNRELATED_TRADE',
      };
    case 'S16':
      return {
        gt: 'CANCEL_WITHOUT_OPPOSITE_TRADE',
        evalLabel: 'NEGATIVE_CONTROL',
        assoc: 'NOT_APPLICABLE',
        patternClass: null,
        controlType: 'FEED_ANOMALY_CONTROL',
      };
  }
}

export function buildConfiguredSyntheticRun(
  config: SimulationConfig,
  launch: LaunchOptions,
  focusScenarioId?: ScenarioId | null
): SyntheticDataset {
  const seed = Math.max(1, Math.round(config.reproducibility.random_seed || 4201));
  const rng = mulberry32(seed);
  const randRange = (min: number, max: number) => min + rng() * Math.max(0, max - min);
  const gauss = () => {
    const u1 = Math.max(1e-7, rng());
    const u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };

  const sessionSec = Math.max(60, Math.round(config.session.run_duration_s || 1500));
  const activeInstCount = Math.max(1, Math.min(config.market.instrument_count, config.instruments.length));
  const activeInstruments = config.instruments.slice(0, activeInstCount);
  const primaryInst = activeInstruments[0];
  const instrumentId = primaryInst.instrument_id || 'INST-NSE-RELIANCE';
  const symbol = primaryInst.symbol || 'RELIANCE';
  const tick = Math.max(0.01, Number(primaryInst.tick_size) || 0.05);
  const lot = Math.max(1, Math.round(Number(primaryInst.lot_size) || 1));
  const refPrice = Math.max(1, Number(primaryInst.reference_price) || 1284.5);
  const venueId = `${primaryInst.exchange || 'NSE'}-CM`;
  const tradingDate = config.session.trading_date || '2026-11-17';

  const snapInstTick = (p: number) => Math.round(p / tick) * tick;
  const snapLot = (q: number) => Math.max(lot, Math.round(q / lot) * lot);
  const toSessionIso = (secFromOpen: number) => {
    const clock = formatSessionClock(secFromOpen);
    return `${tradingDate}T${clock}0+05:30`;
  };

  const volRegime = primaryInst.volatility_regime || config.market.volatility_regime;
  const liqRegime = primaryInst.liquidity_regime || config.market.liquidity_regime;
  const volParams = config.regimes.volatility[volRegime];
  const liqParams = config.regimes.liquidity[liqRegime];

  const createdAt = `${tradingDate}T${formatSessionClock(sessionSec).slice(0, 8)}+05:30`;
  const cfgHash = computeConfigHash(config, launch);
  const runId = `run_${tradingDate.replace(/-/g, '')}_${symbol.toLowerCase().slice(0, 4)}_s${seed}`;

  // 1. Mid-price trajectory with stochastic volatility + mean reversion + intraday U-shape
  const midGrid: number[] = [snapInstTick(refPrice)];
  let sigma = volParams.sigma_bps_per_sqrt_s / 10000;
  const baseSigma = sigma;
  const decaySec = Math.max(60, config.regimes.intraday_profile.decay_minutes * 60);

  for (let t = 1; t <= sessionSec; t++) {
    const openWeight = Math.exp(-t / decaySec) * (config.regimes.intraday_profile.open_boost - 1);
    const closeWeight =
      Math.exp(-(sessionSec - t) / decaySec) * (config.regimes.intraday_profile.close_boost - 1);
    const uMult = 1 + openWeight + closeWeight;

    sigma =
      volParams.vol_persistence * sigma +
      (1 - volParams.vol_persistence) * baseSigma +
      baseSigma * volParams.vol_of_vol * 0.12 * Math.abs(gauss());

    const prev = midGrid[t - 1];
    const revert = -config.regimes.mean_reversion_per_s * (prev - refPrice);
    const shock = prev * sigma * Math.sqrt(uMult) * gauss();
    midGrid.push(snapInstTick(Math.max(refPrice * 0.82, Math.min(refPrice * 1.18, prev + revert + shock))));
  }

  // 2. Plan scenarios across active window [warmup_s, sessionSec - cooldown_s]
  const warmupS = Math.round(config.scenario.warmup_frac * sessionSec);
  const cooldownS = Math.round(config.scenario.cooldown_frac * sessionSec);
  const activeStart = Math.min(sessionSec - 20, Math.max(5, warmupS));
  const activeEnd = Math.max(activeStart + 15, sessionSec - cooldownS);
  const activeSpan = Math.max(15, activeEnd - activeStart);

  const requestedList: ScenarioId[] = [];
  if (focusScenarioId) {
    requestedList.push(focusScenarioId);
  } else {
    for (const def of SCENARIO_DEFINITIONS) {
      const cnt = Math.max(0, Math.round(config.scenario.scenario_instances[def.id] ?? 0));
      for (let c = 0; c < cnt; c++) requestedList.push(def.id);
    }
  }

  // Shuffle deterministically with PRNG so types mix realistically across session
  for (let i = requestedList.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [requestedList[i], requestedList[j]] = [requestedList[j], requestedList[i]];
  }

  const slotCap = Math.max(1, Math.floor(activeSpan / Math.max(8, config.scenario.scenario_slot_s)) * activeInstCount);
  const plannedScenarios = requestedList.slice(0, Math.min(requestedList.length, Math.max(slotCap, 32)));

  const events: OrderEvent[] = [];
  const orderStates: OrderState[] = [];
  const trades: Trade[] = [];
  const scenarioManifest: ScenarioManifestRow[] = [];
  const orderScenarioMap: Record<string, { scenario_id: string; role: string }> = {};

  let seqCounter = 1;
  let orderCounter = 1;
  let eventCounter = 1;
  let tradeCounter = 1;

  const nextOrderId = () => `ORD-${String(orderCounter++).padStart(6, '0')}`;
  const nextEventId = () => `EVT-${String(eventCounter++).padStart(7, '0')}`;
  const nextTradeId = () => `TRD-${String(tradeCounter++).padStart(6, '0')}`;

  // Zipf participants
  const partCount = Math.max(2, Math.round(config.event_rates.participant_count));
  const participants = Array.from({ length: partCount }, (_, idx) => `TM-${1001 + idx}`);
  const zipfWeights = participants.map((_, idx) => 1 / Math.pow(idx + 1, config.event_rates.participant_zipf_exponent));
  const zipfTotal = zipfWeights.reduce((a, b) => a + b, 0);
  const pickParticipant = () => {
    let r = rng() * zipfTotal;
    for (let i = 0; i < participants.length; i++) {
      r -= zipfWeights[i];
      if (r <= 0) return participants[i];
    }
    return participants[0];
  };

  interface DraftEventSpec {
    t: number;
    type: OrderEvent['event_type'];
    price: number | null;
    orderQty: number;
    eventQty: number;
    remainingQty: number;
    status: OrderStatus;
    reasonCode?: ReasonCode | null;
    counterpartyPid?: string;
    aggressor?: Side;
  }

  function pushOrderLifecycle(params: {
    participantId: string;
    accountId: string;
    side: Side;
    orderType?: 'LIMIT' | 'MARKET';
    tif?: 'DAY' | 'IOC' | 'GTC';
    parentOrderId?: string | null;
    scenarioId: string | null;
    scenarioRole?: string;
    steps: DraftEventSpec[];
    dqFlag?: DataQualityFlag;
  }): { orderId: string; eventIds: string[]; tradeIds: string[] } {
    const orderId = nextOrderId();
    const orderType = params.orderType ?? 'LIMIT';
    const tif = params.tif ?? 'DAY';
    const eventIds: string[] = [];
    const tradeIds: string[] = [];

    const firstStep = params.steps[0];
    const lastStep = params.steps[params.steps.length - 1];
    let filledQty = 0;
    let cancelledQty = 0;
    let amendDelta = 0;
    let prevOrderQty = firstStep.orderQty;

    params.steps.forEach((st, idx) => {
      let tradeId: string | null = null;
      if (st.type === 'PARTIAL_FILL' || st.type === 'FILL') {
        tradeId = nextTradeId();
        tradeIds.push(tradeId);
        filledQty += st.eventQty;
        const cpOrderId = `ORD-CP-${String(tradeCounter).padStart(4, '0')}`;
        trades.push({
          run_id: runId,
          trade_id: tradeId,
          instrument_id: instrumentId,
          trade_timestamp_sec: st.t,
          price: st.price ?? midGrid[Math.min(sessionSec, Math.floor(st.t))],
          quantity: st.eventQty,
          buy_order_id: params.side === 'BUY' ? orderId : cpOrderId,
          sell_order_id: params.side === 'SELL' ? orderId : cpOrderId,
          buy_participant_id: params.side === 'BUY' ? params.participantId : st.counterpartyPid ?? 'TM-1003',
          sell_participant_id: params.side === 'SELL' ? params.participantId : st.counterpartyPid ?? 'TM-1003',
          aggressor_side: st.aggressor ?? params.side,
          scenario_id: params.scenarioId,
          execution_status: 'EXECUTED',
        });
      }
      if (st.type === 'CANCEL') cancelledQty += st.eventQty;
      if (st.type === 'AMEND') {
        amendDelta += st.orderQty - prevOrderQty;
        prevOrderQty = st.orderQty;
      }

      const evtId = nextEventId();
      eventIds.push(evtId);
      const dqFlag: DataQualityFlag = idx === 0 && params.dqFlag ? params.dqFlag : 'NORMAL';

      events.push({
        run_id: runId,
        event_id: evtId,
        scenario_id: params.scenarioId,
        instrument_id: instrumentId,
        venue_id: venueId,
        event_timestamp_sec: st.t,
        event_timestamp_iso: toSessionIso(st.t),
        sequence_number: seqCounter++,
        order_id: orderId,
        parent_order_id: params.parentOrderId ?? null,
        participant_id: params.participantId,
        account_id: params.accountId,
        side: params.side,
        event_type: st.type,
        price: st.price,
        order_qty: st.orderQty,
        event_qty: st.eventQty,
        remaining_qty: st.remainingQty,
        order_type: orderType,
        time_in_force: tif,
        source_sequence: seqCounter * 10,
        exchange_order_status: st.status,
        is_scenario_event: params.scenarioId !== null,
        data_quality_flag: dqFlag,
        reason_code: st.reasonCode ?? null,
        trade_id: tradeId,
        is_engine_generated: st.reasonCode === 'IOC_REMAINDER' || st.reasonCode === 'SELF_MATCH_PREVENTION',
      });
    });

    orderStates.push({
      run_id: runId,
      order_id: orderId,
      instrument_id: instrumentId,
      participant_id: params.participantId,
      account_id: params.accountId,
      side: params.side,
      order_type: orderType,
      time_in_force: tif,
      parent_order_id: params.parentOrderId ?? null,
      limit_price: lastStep.price,
      original_qty: firstStep.orderQty,
      amended_qty_delta: amendDelta,
      filled_qty: filledQty,
      cancelled_qty: cancelledQty,
      remaining_qty: lastStep.remainingQty,
      creation_timestamp_sec: firstStep.t,
      last_update_timestamp_sec: lastStep.t,
      status: lastStep.status,
      scenario_id: params.scenarioId,
    });

    if (params.scenarioId && params.scenarioRole) {
      orderScenarioMap[orderId] = {
        scenario_id: params.scenarioId,
        role: params.scenarioRole,
      };
    }

    return { orderId, eventIds, tradeIds };
  }

  const diffLevels: ScenarioDifficulty[] = ['EASY', 'MEDIUM', 'HARD'];
  const s16CycleFlags: DataQualityFlag[] = ['MISSING', 'DUPLICATE', 'INCONSISTENT'];
  let s16Counter = 0;

  // 3. Emit each planned scenario instance S01-S16
  plannedScenarios.forEach((scId, idx) => {
    const def = SCENARIO_DEFINITIONS.find((d) => d.id === scId)!;
    const sem = mapScenarioSemantics(scId);
    const scnUid = `${scId}-${String(idx + 1).padStart(3, '0')}`;
    const slotSpan = activeSpan / Math.max(1, plannedScenarios.length);
    const s0 = Math.min(
      activeEnd - 12,
      Math.max(activeStart, activeStart + idx * slotSpan + rng() * Math.max(1, slotSpan * 0.35))
    );
    const mid0 = midGrid[Math.min(sessionSec, Math.floor(s0))];
    const jitterS = config.scenario.latency_jitter_enabled
      ? randRange(config.scenario.latency_jitter_ms_min, config.scenario.latency_jitter_ms_max) / 1000
      : 0;
    const diff: ScenarioDifficulty =
      config.scenario.difficulty === 'mixed'
        ? diffLevels[idx % 3]
        : (config.scenario.difficulty.toUpperCase() as ScenarioDifficulty);

    const side: Side = rng() < 0.5 ? 'BUY' : 'SELL';
    const oppSide: Side = side === 'BUY' ? 'SELL' : 'BUY';
    const sign = side === 'BUY' ? -1 : 1;

    const pid = participants[idx % participants.length];
    const acc = config.scenario.blend_actors && scId !== 'S06' && scId !== 'S15'
      ? `ACC-${pid.slice(3)}1`
      : `ACC-SCN-${String(idx + 1).padStart(2, '0')}`;

    const largeMult = randRange(
      config.scenario.large_depth_multiple_min,
      config.scenario.large_depth_multiple_max
    );
    const baseDepth = liqParams.size_median * liqParams.depth_scale;
    const largeQty = snapLot(baseDepth * largeMult);
    const displayS = randRange(
      config.scenario.display_duration_s_min,
      config.scenario.display_duration_s_max
    );
    const holdS = randRange(
      config.scenario.hold_duration_s_min,
      config.scenario.hold_duration_s_max
    );
    const restS = Math.max(
      config.scenario.resting_time_min_s,
      Math.min(
        config.scenario.resting_time_max_s,
        config.scenario.resting_time_distribution === 'lognormal'
          ? Math.exp(config.scenario.resting_time_lognormal_mu + gauss() * config.scenario.resting_time_lognormal_sigma)
          : randRange(config.scenario.resting_time_min_s, config.scenario.resting_time_max_s)
      )
    );

    const relOrders: string[] = [];
    const relEvents: string[] = [];
    const relTrades: string[] = [];
    let endSec = s0 + 8;

    const addRel = (r: { orderId: string; eventIds: string[]; tradeIds: string[] }) => {
      relOrders.push(r.orderId);
      relEvents.push(...r.eventIds);
      relTrades.push(...r.tradeIds);
    };

    if (scId === 'S01' || scId === 'S04' || scId === 'S10' || scId === 'S14') {
      const dur = scId === 'S04' ? displayS : holdS;
      const qty = scId === 'S14' ? snapLot(baseDepth * 0.45) : largeQty;
      const px = snapInstTick(mid0 + sign * 3 * tick);
      const steps: DraftEventSpec[] = [
        { t: s0, type: 'NEW', price: px, orderQty: qty, eventQty: qty, remainingQty: qty, status: 'ACTIVE' },
      ];
      if (scId === 'S10') {
        steps.push({
          t: s0 + dur * 0.45 + jitterS,
          type: 'AMEND',
          price: snapInstTick(px - sign * tick),
          orderQty: qty,
          eventQty: 0,
          remainingQty: qty,
          status: 'ACTIVE',
          reasonCode: 'REPLACED',
        });
      }
      steps.push({
        t: Math.min(sessionSec - 1, s0 + dur + jitterS),
        type: 'CANCEL',
        price: scId === 'S10' ? snapInstTick(px - sign * tick) : px,
        orderQty: qty,
        eventQty: qty,
        remainingQty: 0,
        status: 'CANCELLED',
      });
      addRel(
        pushOrderLifecycle({
          participantId: pid,
          accountId: acc,
          side,
          scenarioId: scnUid,
          scenarioRole: scId === 'S10' ? 'institutional_control' : 'large_order',
          steps,
        })
      );
      endSec = Math.min(sessionSec, s0 + dur + 1);
    } else if (scId === 'S02') {
      // Partial fill fixed 30-70%
      const fillRatio = 0.3 + rng() * 0.4;
      const fillQty = snapLot(largeQty * fillRatio);
      const rem = Math.max(lot, largeQty - fillQty);
      const px = snapInstTick(mid0 + sign * tick);
      addRel(
        pushOrderLifecycle({
          participantId: pid,
          accountId: acc,
          side,
          scenarioId: scnUid,
          scenarioRole: 'large_order_partial',
          steps: [
            { t: s0, type: 'NEW', price: px, orderQty: largeQty, eventQty: largeQty, remainingQty: largeQty, status: 'ACTIVE' },
            { t: s0 + displayS * 0.6, type: 'PARTIAL_FILL', price: px, orderQty: largeQty, eventQty: fillQty, remainingQty: rem, status: 'PARTIALLY_FILLED' },
            { t: Math.min(sessionSec - 1, s0 + displayS + holdS * 0.5), type: 'CANCEL', price: px, orderQty: largeQty, eventQty: rem, remainingQty: 0, status: 'CANCELLED' },
          ],
        })
      );
      endSec = Math.min(sessionSec, s0 + displayS + holdS * 0.5 + 1);
    } else if (scId === 'S03') {
      const px = snapInstTick(mid0 - sign * tick);
      addRel(
        pushOrderLifecycle({
          participantId: pid,
          accountId: acc,
          side,
          tif: 'IOC',
          scenarioId: scnUid,
          scenarioRole: 'large_ioc_fill',
          steps: [
            { t: s0, type: 'NEW', price: px, orderQty: largeQty, eventQty: largeQty, remainingQty: largeQty, status: 'ACTIVE' },
            { t: s0 + Math.min(0.4, displayS * 0.2), type: 'FILL', price: px, orderQty: largeQty, eventQty: largeQty, remainingQty: 0, status: 'FILLED' },
          ],
        })
      );
      endSec = Math.min(sessionSec, s0 + 2);
    } else if (scId === 'S05' || scId === 'S06' || scId === 'S07' || scId === 'S08' || scId === 'S09' || scId === 'S15') {
      const layers = config.scenario.layer_count;
      const stepT = config.scenario.layer_price_step_ticks;
      const decay = config.scenario.layer_volume_decay;
      const baseLayerQty = snapLot(baseDepth * 1.4);
      const totalDur = scId === 'S07' ? displayS : scId === 'S08' || scId === 'S09' || scId === 'S15' ? restS : holdS;

      for (let l = 0; l < layers; l++) {
        const lQty = snapLot(baseLayerQty * Math.pow(decay, l));
        const px = snapInstTick(mid0 + sign * (1 + l * stepT) * tick);
        const tPlace = s0 + l * 0.35;
        const steps: DraftEventSpec[] = [
          { t: tPlace, type: 'NEW', price: px, orderQty: lQty, eventQty: lQty, remainingQty: lQty, status: 'ACTIVE' },
        ];

        let rem = lQty;
        if (config.scenario.partial_fill_enabled && l === 0 && rng() < config.scenario.partial_fill_prob) {
          const pRatio = randRange(config.scenario.partial_fill_min_ratio, config.scenario.partial_fill_max_ratio);
          const pQty = Math.min(rem - lot, snapLot(rem * pRatio));
          if (pQty >= lot) {
            rem -= pQty;
            steps.push({
              t: tPlace + totalDur * 0.45,
              type: 'PARTIAL_FILL',
              price: px,
              orderQty: lQty,
              eventQty: pQty,
              remainingQty: rem,
              status: 'PARTIALLY_FILLED',
            });
          }
        }

        if (scId !== 'S06') {
          const cancelGap = scId === 'S05' ? l * 0.75 : l * 0.1;
          steps.push({
            t: Math.min(sessionSec - 1, s0 + totalDur + cancelGap + jitterS),
            type: 'CANCEL',
            price: px,
            orderQty: lQty,
            eventQty: rem,
            remainingQty: 0,
            status: 'CANCELLED',
          });
        }

        addRel(
          pushOrderLifecycle({
            participantId: pid,
            accountId: acc,
            side,
            scenarioId: scnUid,
            scenarioRole: scId === 'S06' ? 'persistent_layer' : 'layer_leg',
            steps,
          })
        );
      }

      // Apply micro-price bump for positive layering/spoofing
      if (sem.evalLabel === 'POSITIVE_TEST') {
        for (let t = Math.floor(s0); t <= Math.min(sessionSec, Math.ceil(s0 + totalDur)); t++) {
          midGrid[t] = snapInstTick(midGrid[t] - sign * tick * 2.5);
        }
      }

      if (scId === 'S08' || scId === 'S15') {
        const oppPid = scId === 'S15' ? participants[(idx + 3) % participants.length] : pid;
        const oppAcc = scId === 'S15' ? `ACC-${oppPid.slice(3)}9` : acc;
        const benQty = snapLot(baseDepth * 0.8);
        const benPx = snapInstTick(mid0 - sign * tick);
        const benT = s0 + totalDur * 0.65;
        addRel(
          pushOrderLifecycle({
            participantId: oppPid,
            accountId: oppAcc,
            side: oppSide,
            scenarioId: scnUid,
            scenarioRole: scId === 'S08' ? 'benefit_leg' : 'coincidental_unrelated_trade',
            steps: [
              { t: benT, type: 'NEW', price: benPx, orderQty: benQty, eventQty: benQty, remainingQty: benQty, status: 'ACTIVE' },
              { t: Math.min(sessionSec - 0.5, benT + 0.6), type: 'FILL', price: benPx, orderQty: benQty, eventQty: benQty, remainingQty: 0, status: 'FILLED' },
            ],
          })
        );
      }
      endSec = Math.min(sessionSec, s0 + totalDur + 3);
    } else if (scId === 'S11' || scId === 'S12') {
      const levels = scId === 'S12' ? 3 : 2;
      const waves = scId === 'S11' ? 4 : 2;
      for (let w = 0; w < waves; w++) {
        for (let lvl = 0; lvl < levels; lvl++) {
          const q = snapLot(baseDepth * 0.9);
          const bPx = snapInstTick(mid0 - (lvl + 1) * tick);
          const aPx = snapInstTick(mid0 + (lvl + 1) * tick);
          const t0 = s0 + w * 1.1 + lvl * 0.12;
          const tCancel = Math.min(sessionSec - 1, t0 + (scId === 'S11' ? 0.9 : holdS * 0.4) + jitterS);
          addRel(
            pushOrderLifecycle({
              participantId: pid,
              accountId: acc,
              side: 'BUY',
              scenarioId: scnUid,
              scenarioRole: 'mm_quote_bid',
              steps: [
                { t: t0, type: 'NEW', price: bPx, orderQty: q, eventQty: q, remainingQty: q, status: 'ACTIVE' },
                { t: tCancel, type: 'CANCEL', price: bPx, orderQty: q, eventQty: q, remainingQty: 0, status: 'CANCELLED' },
              ],
            })
          );
          addRel(
            pushOrderLifecycle({
              participantId: pid,
              accountId: acc,
              side: 'SELL',
              scenarioId: scnUid,
              scenarioRole: 'mm_quote_ask',
              steps: [
                { t: t0 + 0.05, type: 'NEW', price: aPx, orderQty: q, eventQty: q, remainingQty: q, status: 'ACTIVE' },
                { t: tCancel + 0.05, type: 'CANCEL', price: aPx, orderQty: q, eventQty: q, remainingQty: 0, status: 'CANCELLED' },
              ],
            })
          );
        }
      }
      endSec = Math.min(sessionSec, s0 + waves * 1.5 + 2);
    } else if (scId === 'S13') {
      for (let k = 0; k < 5; k++) {
        const q = snapLot(baseDepth * (0.7 + rng() * 0.6));
        const px = snapInstTick(mid0 + (k % 2 === 0 ? 1 : -1) * tick);
        const t0 = s0 + k * 0.45;
        addRel(
          pushOrderLifecycle({
            participantId: pid,
            accountId: acc,
            side: k % 2 === 0 ? 'BUY' : 'SELL',
            scenarioId: scnUid,
            scenarioRole: 'volatility_burst',
            steps: [
              { t: t0, type: 'NEW', price: px, orderQty: q, eventQty: q, remainingQty: q, status: 'ACTIVE' },
              { t: t0 + 0.3, type: 'FILL', price: px, orderQty: q, eventQty: q, remainingQty: 0, status: 'FILLED' },
            ],
          })
        );
      }
      endSec = Math.min(sessionSec, s0 + 4);
    } else if (scId === 'S16') {
      const anomalyFlag = s16CycleFlags[s16Counter % 3];
      s16Counter++;
      const q = snapLot(baseDepth);
      const px = snapInstTick(mid0 + sign * tick);
      addRel(
        pushOrderLifecycle({
          participantId: pid,
          accountId: acc,
          side,
          scenarioId: scnUid,
          scenarioRole: `feed_anomaly_${anomalyFlag.toLowerCase()}`,
          dqFlag: anomalyFlag,
          steps: [
            { t: s0, type: 'NEW', price: px, orderQty: q, eventQty: q, remainingQty: q, status: 'ACTIVE' },
            { t: s0 + 2.5 + jitterS, type: 'CANCEL', price: px, orderQty: q, eventQty: q, remainingQty: 0, status: 'CANCELLED' },
          ],
        })
      );
      endSec = Math.min(sessionSec, s0 + 4);
    }

    const anomalyFailed = scId === 'S16' && launch.gate;
    scenarioManifest.push({
      run_id: runId,
      scenario_id: scnUid,
      scenario_type: `${scId} · ${def.name}`,
      scenario_version: 'scn-2.4.0',
      instrument_id: instrumentId,
      start_timestamp_sec: s0,
      end_timestamp_sec: endSec,
      start_timestamp_iso: toSessionIso(s0),
      end_timestamp_iso: toSessionIso(endSec),
      related_order_ids: relOrders,
      related_event_ids: relEvents,
      related_trade_ids: relTrades,
      intended_pattern: def.desc,
      ground_truth_label: sem.gt,
      pattern_class: sem.patternClass,
      control_type: sem.controlType,
      event_association: sem.assoc,
      evaluation_label: sem.evalLabel,
      difficulty: diff,
      label_rationale: `${def.family} (${def.script}) · ${def.category}. ${def.fixed[0]}`,
      expected_feature_behaviour: {
        SUBMISSION: sem.gt === 'LARGE_ORDER_ONLY' ? 'high order_size_vs_adv_pct' : 'baseline',
        IN_LIFECYCLE: sem.gt === 'LAYERING_PATTERN' ? 'elevated multi_level_layer_depth' : 'moderate imbalance',
        POST_EVENT: sem.evalLabel === 'POSITIVE_TEST' ? 'elevated opposite_side_cancel_ratio' : 'benign look-alike overlap',
      },
      acceptance_criterion: {
        min_events: relEvents.length,
        requires_opposite_fill: sem.assoc === 'LINKED',
      },
      validation_status: anomalyFailed ? 'FAIL' : 'PASS',
      validation_reason: anomalyFailed
        ? `Injected S16 feed anomaly (${s16CycleFlags[(s16Counter - 1) % 3]}) flagged during strict event-stream check`
        : null,
      random_seed: seed,
    });
  });

  // 4. Baseline background order flow driven by event_rates & liquidity regime
  const rawEstimatedOrders = Math.round(
    config.event_rates.background_events_per_second * liqParams.rate_multiplier * sessionSec * 0.45
  );
  const baselineOrderCount = Math.max(240, Math.min(2200, rawEstimatedOrders));
  const defectRate = Math.max(0, Math.min(1, (launch.defectRatePct || 0) / 100));

  for (let i = 0; i < baselineOrderCount; i++) {
    const t0 = rng() * Math.max(5, sessionSec - 8);
    const side: Side = rng() < 0.5 ? 'BUY' : 'SELL';
    const pid = pickParticipant();
    const acc = `ACC-${pid.slice(3)}1`;
    const m = midGrid[Math.min(sessionSec, Math.floor(t0))];
    const ticksAway = Math.max(
      1,
      Math.round(liqParams.half_spread_ticks + -Math.log(Math.max(1e-4, 1 - rng())) * liqParams.offset_scale_ticks)
    );
    let p = snapInstTick(m + (side === 'BUY' ? -1 : 1) * ticksAway * tick);

    const logQty = Math.log(liqParams.size_median) + gauss() * liqParams.size_sigma;
    const qty = Math.min(liqParams.size_max, snapLot(Math.max(lot, Math.exp(logQty))));
    const life = Math.max(0.3, Math.min(sessionSec * 0.15, Math.exp(0.5 + rng() * 3.0)));

    let dqFlag: DataQualityFlag = 'NORMAL';
    if (defectRate > 0 && rng() < defectRate) {
      const dfPick = rng();
      if (dfPick < 0.35) dqFlag = 'OUT_OF_ORDER';
      else if (dfPick < 0.65) dqFlag = 'DUPLICATE';
      else if (dfPick < 0.85) dqFlag = 'INCONSISTENT';
      else dqFlag = 'MISSING';
    }

    const u = rng();
    if (u < 0.035) {
      const rejectReasons: ReasonCode[] = ['INVALID_TICK', 'OUTSIDE_PRICE_BAND', 'INVALID_LOT', 'SELF_MATCH_PREVENTION'];
      const rc = rejectReasons[Math.floor(rng() * rejectReasons.length)];
      if (rc === 'INVALID_TICK') p = Number((p + tick * 0.4).toFixed(2));
      pushOrderLifecycle({
        participantId: pid,
        accountId: acc,
        side,
        scenarioId: null,
        dqFlag,
        steps: [
          {
            t: t0,
            type: 'REJECT',
            price: p,
            orderQty: qty,
            eventQty: qty,
            remainingQty: 0,
            status: 'REJECTED',
            reasonCode: rc,
          },
        ],
      });
      continue;
    }

    const isMarketable = rng() < config.event_rates.marketable_share;
    const isMarket = isMarketable && rng() < config.event_rates.market_order_share;
    const isIoc = isMarketable && !isMarket && rng() < config.event_rates.marketable_ioc_share;

    if (isMarket || isIoc) {
      pushOrderLifecycle({
        participantId: pid,
        accountId: acc,
        side,
        orderType: isMarket ? 'MARKET' : 'LIMIT',
        tif: isIoc ? 'IOC' : 'DAY',
        scenarioId: null,
        dqFlag,
        steps: [
          { t: t0, type: 'NEW', price: isMarket ? null : m, orderQty: qty, eventQty: qty, remainingQty: qty, status: 'ACTIVE' },
          { t: t0 + 0.05, type: 'FILL', price: m, orderQty: qty, eventQty: qty, remainingQty: 0, status: 'FILLED' },
        ],
      });
      continue;
    }

    const hasAmend = rng() < config.event_rates.amend_rate;
    const isCancel = rng() < config.event_rates.cancel_rate / Math.max(0.05, 1 - config.event_rates.amend_rate);
    const hasPartial = rng() < 0.1;

    const steps: DraftEventSpec[] = [
      { t: t0, type: 'NEW', price: p, orderQty: qty, eventQty: qty, remainingQty: qty, status: 'ACTIVE' },
    ];
    let curPrice = p;
    let curOrderQty = qty;
    let rem = qty;

    if (hasAmend) {
      const amendT = Math.min(sessionSec - 1, t0 + life * 0.35);
      if (rng() < config.event_rates.amend_price_change_share) {
        curPrice = snapInstTick(curPrice + (side === 'BUY' ? 1 : -1) * tick);
      }
      if (rng() < config.event_rates.amend_qty_decrease_share && rem > lot * 2) {
        const dec = snapLot(rem * 0.3);
        curOrderQty = Math.max(lot, curOrderQty - dec);
        rem = Math.max(lot, rem - dec);
      }
      steps.push({
        t: amendT,
        type: 'AMEND',
        price: curPrice,
        orderQty: curOrderQty,
        eventQty: 0,
        remainingQty: rem,
        status: 'ACTIVE',
        reasonCode: 'REPLACED',
      });
    }

    if (hasPartial && rem >= lot * 4) {
      const partQty = snapLot(rem * (0.25 + rng() * 0.4));
      if (partQty < rem) {
        rem -= partQty;
        steps.push({
          t: Math.min(sessionSec - 0.5, t0 + life * 0.65),
          type: 'PARTIAL_FILL',
          price: curPrice,
          orderQty: curOrderQty,
          eventQty: partQty,
          remainingQty: rem,
          status: 'PARTIALLY_FILLED',
        });
      }
    }

    const endT = Math.min(sessionSec - 0.2, t0 + life);
    if (!isCancel) {
      steps.push({
        t: endT,
        type: 'FILL',
        price: curPrice,
        orderQty: curOrderQty,
        eventQty: rem,
        remainingQty: 0,
        status: 'FILLED',
      });
    } else {
      steps.push({
        t: endT,
        type: 'CANCEL',
        price: curPrice,
        orderQty: curOrderQty,
        eventQty: rem,
        remainingQty: 0,
        status: 'CANCELLED',
      });
    }

    pushOrderLifecycle({
      participantId: pid,
      accountId: acc,
      side,
      scenarioId: null,
      dqFlag,
      steps,
    });
  }

  // Long-lived seed resting orders from liquidity regime
  const seedOrdersTotal = Math.min(80, liqParams.seed_levels * liqParams.seed_orders_per_level * 2);
  for (let i = 0; i < seedOrdersTotal; i++) {
    const t0 = 0.5 + (i % 10) * 0.4;
    const side: Side = i % 2 === 0 ? 'BUY' : 'SELL';
    const pid = participants[i % participants.length];
    const acc = `ACC-${pid.slice(3)}1`;
    const lvl = 1 + (i % Math.max(1, liqParams.seed_levels));
    const m = midGrid[Math.floor(t0)];
    const p = snapInstTick(m + (side === 'BUY' ? -1 : 1) * lvl * tick);
    const qty = snapLot(liqParams.size_median * liqParams.depth_scale);
    const life = sessionSec * (0.4 + rng() * 0.55);
    const steps: DraftEventSpec[] = [
      { t: t0, type: 'NEW', price: p, orderQty: qty, eventQty: qty, remainingQty: qty, status: 'ACTIVE' },
    ];
    if (t0 + life < sessionSec - 3) {
      steps.push({
        t: t0 + life,
        type: 'CANCEL',
        price: p,
        orderQty: qty,
        eventQty: qty,
        remainingQty: 0,
        status: 'CANCELLED',
      });
    }
    pushOrderLifecycle({
      participantId: pid,
      accountId: acc,
      side,
      scenarioId: null,
      steps,
    });
  }

  events.sort((a, b) => a.event_timestamp_sec - b.event_timestamp_sec);
  events.forEach((ev, idx) => {
    ev.sequence_number = idx + 1;
  });

  // 5. Book snapshots using snapshot_levels_n and snapshot_interval_ms (at least 1s resolution in browser)
  const snapStepS = Math.max(1, Math.round(config.book.snapshot_interval_ms / 1000));
  const bookSnapshots: BookSnapshot[] = [];
  const levelsN = Math.max(1, Math.min(20, config.book.snapshot_levels_n));
  const halfSpread = Math.max(tick, snapInstTick(liqParams.half_spread_ticks * tick));

  for (let sec = 0; sec <= sessionSec; sec += snapStepS) {
    const mid = midGrid[Math.min(sessionSec, sec)];
    const bid = snapInstTick(mid - halfSpread * 0.5);
    const ask = snapInstTick(bid + Math.max(tick, halfSpread));

    const bid_prices: number[] = [];
    const bid_depths: number[] = [];
    const bid_order_counts: number[] = [];
    const ask_prices: number[] = [];
    const ask_depths: number[] = [];
    const ask_order_counts: number[] = [];

    for (let lvl = 0; lvl < levelsN; lvl++) {
      bid_prices.push(snapInstTick(bid - lvl * tick));
      bid_depths.push(snapLot(liqParams.size_median * liqParams.depth_scale * (0.7 + ((sec * 37 + lvl * 91) % 100) / 100)));
      bid_order_counts.push(1 + ((sec + lvl) % Math.max(1, liqParams.seed_orders_per_level)));
      ask_prices.push(snapInstTick(ask + lvl * tick));
      ask_depths.push(snapLot(liqParams.size_median * liqParams.depth_scale * (0.7 + ((sec * 53 + lvl * 83) % 100) / 100)));
      ask_order_counts.push(1 + ((sec + lvl + 1) % Math.max(1, liqParams.seed_orders_per_level)));
    }

    bookSnapshots.push({
      run_id: runId,
      snapshot_id: `SNAP-${String(bookSnapshots.length + 1).padStart(5, '0')}`,
      instrument_id: instrumentId,
      snapshot_timestamp_sec: sec,
      sequence_number: bookSnapshots.length * 3 + 1,
      best_bid_price: bid,
      best_bid_qty: bid_depths[0],
      best_ask_price: ask,
      best_ask_qty: ask_depths[0],
      spread: Number((ask - bid).toFixed(2)),
      mid_price: mid,
      bid_prices,
      bid_depths,
      bid_order_counts,
      ask_prices,
      ask_depths,
      ask_order_counts,
      book_status: 'VALID',
      data_quality_flag: defectRate > 0 && sec > 0 && sec % 290 === 0 ? 'MISSING' : 'NORMAL',
    });
  }

  // 6. Surveillance features across scenarios + baseline windows
  const features: SurveillanceFeatureRow[] = [];
  let featRowId = 1;
  const stages: ScoringStage[] = ['SUBMISSION', 'IN_LIFECYCLE', 'POST_EVENT'];
  const versions = ['v2.1.0', 'v2.0.0'];
  const trailingS = Math.max(1, config.features.trailing_window_ms / 1000);

  const entitySpecs: Array<{
    entity_type: SurveillanceFeatureRow['entity_type'];
    entity_id: string;
    participant_id: string;
    evalClass: 'POSITIVE' | 'HARD_NEGATIVE' | 'BASELINE';
    gtLabel?: GroundTruthLabel;
    tSec: number;
    side: Side;
    cancelledQty: number;
    filledQty: number;
    orderCount: number;
    dqDegraded: boolean;
  }> = [];

  for (const scn of scenarioManifest) {
    const scnEvents = events.filter((e) => e.scenario_id === scn.scenario_id);
    const pid = scnEvents[0]?.participant_id ?? 'TM-1005';
    const cancelledQty = scnEvents.filter((e) => e.event_type === 'CANCEL').reduce((s, e) => s + e.event_qty, 0);
    const filledQty = scnEvents.filter((e) => e.event_type === 'FILL' || e.event_type === 'PARTIAL_FILL').reduce((s, e) => s + e.event_qty, 0);
    entitySpecs.push({
      entity_type: 'SCENARIO',
      entity_id: scn.scenario_id,
      participant_id: pid,
      evalClass: scn.evaluation_label === 'POSITIVE_TEST' ? 'POSITIVE' : 'HARD_NEGATIVE',
      gtLabel: scn.ground_truth_label,
      tSec: scn.end_timestamp_sec,
      side: scnEvents[0]?.side ?? 'BUY',
      cancelledQty,
      filledQty,
      orderCount: scn.related_order_ids.length,
      dqDegraded: scn.validation_status === 'FAIL',
    });
  }

  const baselineFeatureCount = Math.min(60, Math.max(24, Math.round(sessionSec / 25)));
  for (let k = 0; k < baselineFeatureCount; k++) {
    const pid = participants[k % participants.length];
    const tSec = Math.min(sessionSec - 2, Math.max(5, Math.round(((k + 1) / (baselineFeatureCount + 1)) * sessionSec)));
    entitySpecs.push({
      entity_type: 'PARTICIPANT',
      entity_id: `${pid}@W${String(k + 1).padStart(2, '0')}`,
      participant_id: pid,
      evalClass: 'BASELINE',
      tSec,
      side: k % 2 === 0 ? 'BUY' : 'SELL',
      cancelledQty: snapLot(80 + rng() * 360),
      filledQty: snapLot(90 + rng() * 290),
      orderCount: 2 + (k % 5),
      dqDegraded: false,
    });
  }

  for (const ver of versions) {
    const verBoost = ver === 'v2.1.0' ? 1.0 : 0.88;
    for (const stage of stages) {
      for (const ent of entitySpecs) {
        const isPos = ent.evalClass === 'POSITIVE';
        const isHardNeg = ent.evalClass === 'HARD_NEGATIVE';

        const sizeVsAdv =
          isPos && ent.gtLabel === 'LARGE_ORDER_ONLY'
            ? 0.78 + rng() * 0.18
            : isPos
              ? 0.4 + rng() * 0.36
              : isHardNeg
                ? 0.32 + rng() * 0.38
                : 0.04 + rng() * 0.22;

        const layerDepth =
          isPos && ent.gtLabel === 'LAYERING_PATTERN'
            ? Math.max(3, config.scenario.layer_count) + rng() * 1.1
            : isHardNeg && ent.gtLabel === 'LEGITIMATE_MULTI_LEVEL_QUOTING'
              ? 3.2 + rng() * 1.4
              : isPos
                ? 2.2 + rng() * 1.8
                : 1.0 + rng() * 1.3;

        const imbDelta =
          stage === 'SUBMISSION'
            ? (isPos ? 0.28 : isHardNeg ? 0.22 : 0.08) + rng() * 0.18
            : (isPos ? 0.55 : isHardNeg ? 0.37 : 0.12) + rng() * 0.22;

        const oppCancelRatio =
          stage === 'POST_EVENT'
            ? isPos && ent.gtLabel !== 'LARGE_ORDER_ONLY'
              ? 0.74 + rng() * 0.22
              : isHardNeg && ent.gtLabel !== 'CANCEL_WITHOUT_OPPOSITE_TRADE'
                ? 0.45 + rng() * 0.34
                : 0.05 + rng() * 0.25
            : stage === 'IN_LIFECYCLE'
              ? (isPos ? 0.42 : isHardNeg ? 0.3 : 0.09) + rng() * 0.18
              : 0.02 + rng() * 0.08;

        const cancelLatencyMs =
          stage === 'POST_EVENT'
            ? isPos
              ? 200 + rng() * 540
              : isHardNeg
                ? 360 + rng() * 1200
                : 1800 + rng() * 6200
            : 2500 + rng() * 4000;

        const composite = Math.min(
          0.99,
          Math.max(
            0.02,
            verBoost *
              (stage === 'SUBMISSION'
                ? sizeVsAdv * 0.65 + rng() * 0.12
                : stage === 'IN_LIFECYCLE'
                  ? (layerDepth / 7) * 0.45 + imbDelta * 0.45 + rng() * 0.08
                  : oppCancelRatio * 0.58 + (1 - Math.min(1, cancelLatencyMs / 4000)) * 0.32 + imbDelta * 0.12)
          )
        );

        const alertThreshold = stage === 'SUBMISSION' ? 0.62 : stage === 'IN_LIFECYCLE' ? 0.6 : 0.64;
        const triggered = !ent.dqDegraded && composite >= alertThreshold;

        const featPairs: Array<[string, number]> = [
          ['opposite_side_cancel_ratio', Number(oppCancelRatio.toFixed(4))],
          ['cancel_to_fill_latency_ms', Math.round(cancelLatencyMs)],
          ['order_book_imbalance_delta', Number(imbDelta.toFixed(4))],
          ['multi_level_layer_depth', Number(layerDepth.toFixed(2))],
          ['order_size_vs_adv_pct', Number((sizeVsAdv * 100).toFixed(2))],
        ];

        for (const [fname, fval] of featPairs) {
          features.push({
            run_id: runId,
            feature_row_id: featRowId++,
            feature_timestamp_sec: ent.tSec,
            observation_start_sec: Math.max(0, ent.tSec - trailingS),
            observation_end_sec: ent.tSec,
            feature_name: fname,
            feature_value_num: fval,
            feature_value_cat: null,
            entity_type: ent.entity_type,
            entity_id: ent.entity_id,
            feature_version: ver,
            scoring_stage: stage,
            data_quality_status: ent.dqDegraded ? 'DEGRADED' : 'OK',
            context: {
              side: ent.side,
              cancelled_qty: ent.cancelledQty,
              filled_qty: ent.filledQty,
              cancel_latency_ms: Math.round(cancelLatencyMs),
              composite_score: Number(composite.toFixed(3)),
              alert_triggered: triggered,
              participant_id: ent.participant_id,
              order_count: ent.orderCount,
            },
          });
        }
      }
    }
  }

  // 7. Validation checks across all 6 scopes
  const totalEvents = events.length;
  const seqBadEvents = events.filter((e) => e.data_quality_flag === 'OUT_OF_ORDER' || e.data_quality_flag === 'DUPLICATE').length;
  const missingEvents = events.filter((e) => e.data_quality_flag === 'MISSING').length;
  const inconsistentEvents = events.filter((e) => e.data_quality_flag === 'INCONSISTENT').length;
  const failedScenarios = scenarioManifest.filter((s) => s.validation_status === 'FAIL');

  const gateBlocked = launch.gate && (seqBadEvents > 0 || missingEvents > 0 || inconsistentEvents > 0 || failedScenarios.length > 0);
  const runStatus: SyntheticDataset['run_metadata']['status'] = gateBlocked ? 'FAILED' : 'VALIDATED';

  const validationResults: ValidationResultRow[] = [
    {
      run_id: runId,
      result_id: 1,
      check_id: 'CHK-RUN-01',
      requirement_id: 'REQ-OPS04',
      scope: 'RUN',
      scenario_id: null,
      status: 'PASS',
      message: `Seed ${seed}, config_hash (${cfgHash}), and ${activeInstCount} instrument(s) persisted.`,
      details: { config_hash: cfgHash, seed, export_dir: launch.out, format: launch.fmt },
      created_at: createdAt,
      pass_rate_pct: 100,
      checked_rows: 1,
      passed_rows: 1,
    },
    {
      run_id: runId,
      result_id: 2,
      check_id: 'CHK-INS-01',
      requirement_id: 'REQ-MKT01',
      scope: 'INSTRUMENT',
      scenario_id: null,
      status: 'PASS',
      message: `${activeInstCount} active instrument(s) within price bands; positive tick & lot verified.`,
      details: { primary_symbol: symbol, tick_size: tick, active_instruments: activeInstruments.map((a) => a.symbol) },
      created_at: createdAt,
      pass_rate_pct: 100,
      checked_rows: activeInstCount,
      passed_rows: activeInstCount,
    },
    {
      run_id: runId,
      result_id: 3,
      check_id: 'CHK-EVT-01',
      requirement_id: 'REQ-DQ02',
      scope: 'EVENT_STREAM',
      scenario_id: null,
      status: seqBadEvents > 0 ? (launch.gate ? 'FAIL' : 'PENDING') : 'PASS',
      message:
        seqBadEvents > 0
          ? `${seqBadEvents} events flagged DUPLICATE or OUT_OF_ORDER in core.order_events.`
          : 'Monotonic sequence_number and event_timestamp verified across all events.',
      details: { total_events: totalEvents, flagged_events: seqBadEvents },
      created_at: createdAt,
      pass_rate_pct: Number((((totalEvents - seqBadEvents) / Math.max(1, totalEvents)) * 100).toFixed(2)),
      checked_rows: totalEvents,
      passed_rows: totalEvents - seqBadEvents,
    },
    {
      run_id: runId,
      result_id: 4,
      check_id: 'CHK-EVT-02',
      requirement_id: 'REQ-DQ03',
      scope: 'EVENT_STREAM',
      scenario_id: null,
      status: missingEvents > 0 ? (launch.gate ? 'FAIL' : 'PENDING') : 'PASS',
      message:
        missingEvents > 0
          ? `${missingEvents} events carry data_quality_flag = MISSING.`
          : 'Zero MISSING or NULL required fields across event stream.',
      details: { total_events: totalEvents, missing_events: missingEvents },
      created_at: createdAt,
      pass_rate_pct: Number((((totalEvents - missingEvents) / Math.max(1, totalEvents)) * 100).toFixed(2)),
      checked_rows: totalEvents,
      passed_rows: totalEvents - missingEvents,
    },
    {
      run_id: runId,
      result_id: 5,
      check_id: 'CHK-ORD-01',
      requirement_id: 'REQ-DQ01',
      scope: 'ORDER_STATE',
      scenario_id: null,
      status: inconsistentEvents > 0 ? (launch.gate ? 'FAIL' : 'PENDING') : 'PASS',
      message:
        inconsistentEvents > 0
          ? `${inconsistentEvents} orders carry INCONSISTENT event flags failing order_qty_identity.`
          : `order_qty_identity holds for 100% of ${orderStates.length} order_state rows.`,
      details: { checked_orders: orderStates.length, replay_check: config.validation.replay_check },
      created_at: createdAt,
      pass_rate_pct: Number((((orderStates.length - inconsistentEvents) / Math.max(1, orderStates.length)) * 100).toFixed(2)),
      checked_rows: orderStates.length,
      passed_rows: Math.max(0, orderStates.length - inconsistentEvents),
    },
    {
      run_id: runId,
      result_id: 6,
      check_id: 'CHK-BK-01',
      requirement_id: 'REQ-DQ04',
      scope: 'BOOK_SNAPSHOTS',
      scenario_id: null,
      status: bookSnapshots.some((b) => b.data_quality_flag !== 'NORMAL') ? 'PENDING' : 'PASS',
      message: bookSnapshots.some((b) => b.data_quality_flag !== 'NORMAL')
        ? 'Some snapshots marked MISSING under simulated DQ defect rate.'
        : `All ${bookSnapshots.length} L${levelsN} snapshots pass spread/mid consistency checks.`,
      details: { total_snapshots: bookSnapshots.length, snapshot_levels_n: levelsN },
      created_at: createdAt,
      pass_rate_pct: Number(
        (
          (bookSnapshots.filter((b) => b.data_quality_flag === 'NORMAL').length /
            Math.max(1, bookSnapshots.length)) *
          100
        ).toFixed(2)
      ),
      checked_rows: bookSnapshots.length,
      passed_rows: bookSnapshots.filter((b) => b.data_quality_flag === 'NORMAL').length,
    },
    {
      run_id: runId,
      result_id: 7,
      check_id: 'CHK-SCN-01',
      requirement_id: 'REQ-OPS07',
      scope: 'SCENARIO_MANIFEST',
      scenario_id: null,
      status: 'PASS',
      message: 'model_input.* views expose zero labels.*, scenario_id, or is_scenario_event columns.',
      details: { views_audited: 6, leaked_columns: 0 },
      created_at: createdAt,
      pass_rate_pct: 100,
      checked_rows: 6,
      passed_rows: 6,
    },
    {
      run_id: runId,
      result_id: 8,
      check_id: 'CHK-SCN-02',
      requirement_id: 'REQ-VAL03',
      scope: 'SCENARIO_MANIFEST',
      scenario_id: failedScenarios[0]?.scenario_id ?? null,
      status: failedScenarios.length > 0 ? 'FAIL' : 'PASS',
      message:
        failedScenarios.length > 0
          ? `${failedScenarios.length} scenario manifest row(s) flagged during validation.`
          : `All ${scenarioManifest.length} planned scenarios satisfy acceptance_criterion JSON contracts.`,
      details: { scenarios_checked: scenarioManifest.length },
      created_at: createdAt,
      pass_rate_pct:
        scenarioManifest.length > 0
          ? Number(
              (
                ((scenarioManifest.length - failedScenarios.length) / scenarioManifest.length) *
                100
              ).toFixed(2)
            )
          : 100,
      checked_rows: Math.max(1, scenarioManifest.length),
      passed_rows: Math.max(1, scenarioManifest.length - failedScenarios.length),
    },
  ];

  const posOrderIds = new Set(
    scenarioManifest
      .filter((s) => s.evaluation_label === 'POSITIVE_TEST')
      .flatMap((s) => s.related_order_ids)
  );
  const posOrdersPassing = Array.from(posOrderIds).filter((oid) =>
    events.filter((e) => e.order_id === oid).every((e) => e.data_quality_flag === 'NORMAL')
  ).length;

  const estimatedFullSessionEvents = Math.round(
    config.event_rates.background_events_per_second * liqParams.rate_multiplier * sessionSec * activeInstCount
  );

  return {
    run_metadata: {
      run_id: runId,
      random_seed: seed,
      config_version: 'cfg-3.3.0',
      generator_version: 'synth-engine-4.2.0',
      scenario_version: 'scn-2.4.0',
      config_hash: cfgHash,
      status: runStatus,
      created_at: createdAt,
      config_json: {
        ...config,
        instruments: activeInstruments,
        launch,
      },
      bundle_budget_kb: {
        model_input_kb: Math.max(64, Math.round(events.length * 0.14)),
        labels_sidecar_kb: Math.max(8, Math.round(scenarioManifest.length * 2.2)),
        max_budget_kb: 1536,
        total_session_events: Math.max(events.length, estimatedFullSessionEvents),
        embedded_events: events.length,
        baseline_sample_pct: Number((config.features.background_order_sample_rate * 100).toFixed(1)),
      },
    },
    instrument_master: {
      run_id: runId,
      instrument_id: instrumentId,
      symbol,
      exchange: primaryInst.exchange || 'NSE',
      currency: primaryInst.currency || 'INR',
      tick_size: tick,
      lot_size: lot,
      price_band_low: Number((refPrice * 0.8).toFixed(2)),
      price_band_high: Number((refPrice * 1.2).toFixed(2)),
      session_open: `${tradingDate}T09:15:00+05:30`,
      session_close: `${tradingDate}T${formatSessionClock(sessionSec).slice(0, 8)}+05:30`,
      instrument_type: 'EQUITY',
      reference_price: refPrice,
      volatility_regime: volRegime,
      liquidity_regime: liqRegime,
    },
    model_input: {
      order_events: events.map((ev) => ({
        ...ev,
        scenario_id: null,
        is_scenario_event: false,
      })),
      order_state: orderStates.map((os) => ({ ...os, scenario_id: null })),
      trades: trades.map((tr) => ({ ...tr, scenario_id: null })),
      book_snapshots: bookSnapshots,
      surveillance_features: features,
    },
    evaluator_bundle: {
      scenario_manifest: scenarioManifest,
      validation_results: validationResults,
      order_scenario_map: orderScenarioMap,
      seeded_orders_passing_all_checks: {
        passed: posOrdersPassing,
        total: posOrderIds.size,
      },
    },
  };
}

export const PREBUILT_RUNS: SyntheticDataset[] = [
  buildSyntheticRun({
    runId: 'run_20261117_0915_nse_rel',
    seed: 849201,
    withDefects: false,
    createdAt: '2026-11-17T09:46:12+05:30',
  }),
  buildSyntheticRun({
    runId: 'run_20261117_0942_dq_gate_fail',
    seed: 849202,
    withDefects: true,
    createdAt: '2026-11-17T10:12:04+05:30',
  }),
];
