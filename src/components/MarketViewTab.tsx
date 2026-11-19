import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import {
  BookSnapshot,
  ClassFilterBucket,
  EventAssociation,
  EventType,
  GroundTruthLabel,
  InstrumentMaster,
  OrderEvent,
  RebuiltOrderLifeline,
  ReportArtifactMode,
  ScenarioDifficulty,
  ScenarioManifestRow,
  Side,
} from '../types/surveillance';
import {
  formatSessionClock,
  getNearestSnapshotAtTime,
  rebuildOrderLifelines,
  replayOrderBookAtTime,
} from '../data/syntheticRunGenerator';
import { OrderBookLadder } from './OrderBookLadder';

interface MarketViewTabProps {
  artifactMode: ReportArtifactMode;
  revealLabels: boolean;
  orderEvents: OrderEvent[];
  bookSnapshots: BookSnapshot[];
  scenarios: ScenarioManifestRow[];
  orderScenarioMap: Record<string, { scenario_id: string; role: string }>;
  focusedScenarioId: string;
  onChangeFocusedScenario: (scenarioId: string) => void;
  highlightParticipantId: string | null;
  onClearHighlightParticipant: () => void;
  darkMode: boolean;
  sessionDurationSec?: number;
  instruments?: InstrumentMaster[];
  selectedInstrumentId?: string;
  onSelectInstrument?: (instrumentId: string) => void;
}

const DEFAULT_SESSION_DURATION = 21600;
const MICRO_LOD_THRESHOLD_SEC = 120; // Switch from density heatmap to individual lifelines under 2 minutes

const GT_LABELS: GroundTruthLabel[] = [
  'SPOOFING_LIKE_SEQUENCE',
  'LAYERING_PATTERN',
  'LARGE_ORDER_ONLY',
  'LEGITIMATE_MULTI_LEVEL_QUOTING',
  'LEGITIMATE_LARGE_ORDER',
  'CANCEL_WITHOUT_OPPOSITE_TRADE',
  'COINCIDENTAL_OPPOSITE_TRADE',
];

function classifyLifeline(
  l: RebuiltOrderLifeline,
  scenarioById: Map<string, ScenarioManifestRow>
): ClassFilterBucket {
  if (!l.scenario_id) return 'BASELINE';
  const scn = scenarioById.get(l.scenario_id);
  if (!scn) return 'BASELINE';
  if (scn.evaluation_label === 'POSITIVE_TEST') return 'POSITIVE_TEST';
  if (scn.ground_truth_label === 'LEGITIMATE_LARGE_ORDER') return 'OTHER_CONTROL';
  return 'HARD_NEGATIVE';
}

export const MarketViewTab: React.FC<MarketViewTabProps> = ({
  artifactMode,
  revealLabels,
  orderEvents,
  bookSnapshots,
  scenarios,
  orderScenarioMap,
  focusedScenarioId,
  onChangeFocusedScenario,
  highlightParticipantId,
  onClearHighlightParticipant,
  darkMode,
  sessionDurationSec = DEFAULT_SESSION_DURATION,
  instruments,
  selectedInstrumentId,
  onSelectInstrument,
}) => {
  const canReveal = artifactMode === 'evaluator' && revealLabels;

  // X-axis zoom window state (0..sessionDurationSec)
  const [zoomRange, setZoomRange] = useState<[number, number]>([0, sessionDurationSec]);
  const windowDuration = zoomRange[1] - zoomRange[0];
  const isMicroLod = windowDuration <= MICRO_LOD_THRESHOLD_SEC;

  useEffect(() => {
    setZoomRange([0, sessionDurationSec]);
    setPinnedTimeSec(null);
    setClickedOrderId(null);
    setClickedOrderPrice(null);
  }, [orderEvents, sessionDurationSec]);

  // Grouped Toggles: Side, Event Marks, Class, Baseline Opacity, Depth Backdrop
  const [sideToggles, setSideToggles] = useState<Record<Side, boolean>>({
    BUY: true,
    SELL: true,
  });
  const [markToggles, setMarkToggles] = useState<{
    AMEND: boolean;
    PARTIAL_FILL: boolean;
    FILL: boolean;
    CANCEL: boolean;
    REJECT: boolean;
  }>({
    AMEND: true,
    PARTIAL_FILL: true,
    FILL: true,
    CANCEL: true,
    REJECT: true,
  });
  const [classToggles, setClassToggles] = useState<Record<ClassFilterBucket, boolean>>({
    POSITIVE_TEST: true,
    HARD_NEGATIVE: true,
    OTHER_CONTROL: true,
    BASELINE: true,
  });
  const [baselineOpacity, setBaselineOpacity] = useState<number>(20);
  const [hoveredClass, setHoveredClass] = useState<ClassFilterBucket | null>(null);
  const [showDepthBackdrop, setShowDepthBackdrop] = useState<boolean>(true);

  // Filters: min qty, min lifetime, participant + fine label filters
  const [minQty, setMinQty] = useState<number>(0);
  const [minLifetimeSec, setMinLifetimeSec] = useState<number>(0);
  const [participantFilter, setParticipantFilter] = useState<string>('ALL');
  const [labelFilter, setLabelFilter] = useState<'ALL' | GroundTruthLabel>('ALL');
  const [assocFilter, setAssocFilter] = useState<'ALL' | EventAssociation>('ALL');
  const [diffFilter, setDiffFilter] = useState<'ALL' | ScenarioDifficulty>('ALL');

  // Cursor & Order Book Ladder state
  const [hoverTimeSec, setHoverTimeSec] = useState<number | null>(null);
  const [pinnedTimeSec, setPinnedTimeSec] = useState<number | null>(null);
  const [clickedOrderId, setClickedOrderId] = useState<string | null>(null);
  const [clickedOrderPrice, setClickedOrderPrice] = useState<number | null>(null);
  const [bookModeOverride, setBookModeOverride] = useState<'auto' | 'snapshot' | 'replay'>('auto');

  // Table filters
  const [eventTypeFilter, setEventTypeFilter] = useState<'ALL' | EventType>('ALL');
  const [eventSearch, setEventSearch] = useState('');

  // Hover tooltip state
  const [hoveredOrder, setHoveredOrder] = useState<{
    lifeline: RebuiltOrderLifeline;
    scenario?: ScenarioManifestRow;
    x: number;
    y: number;
  } | null>(null);

  const mainCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overviewCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Brush dragging state
  const brushDragRef = useRef<{
    mode: 'move' | 'left' | 'right' | 'create';
    startX: number;
    origRange: [number, number];
  } | null>(null);

  const scenarioById = useMemo(() => {
    const map = new Map<string, ScenarioManifestRow>();
    if (canReveal) {
      for (const s of scenarios) map.set(s.scenario_id, s);
    }
    return map;
  }, [scenarios, canReveal]);

  const lifelines = useMemo(() => {
    return rebuildOrderLifelines(
      orderEvents,
      canReveal ? orderScenarioMap : undefined,
      sessionDurationSec
    );
  }, [orderEvents, orderScenarioMap, canReveal, sessionDurationSec]);

  const allParticipants = useMemo(() => {
    const set = new Set<string>();
    for (const l of lifelines) set.add(l.participant_id);
    return Array.from(set).sort();
  }, [lifelines]);

  // Jump brush when focusedScenarioId changes (e.g. from dropdown or Detector tab)
  const activeScenario =
    canReveal && focusedScenarioId !== 'all' ? scenarioById.get(focusedScenarioId) : undefined;

  useEffect(() => {
    if (activeScenario) {
      const pad = 16;
      const a = Math.max(0, activeScenario.start_timestamp_sec - pad);
      const b = Math.min(sessionDurationSec, activeScenario.end_timestamp_sec + pad);
      setZoomRange([a, Math.max(a + 20, b)]);
      setPinnedTimeSec(
        Math.min(
          sessionDurationSec,
          (activeScenario.start_timestamp_sec + activeScenario.end_timestamp_sec) / 2
        )
      );
      setClickedOrderId(null);
      setClickedOrderPrice(null);
    }
  }, [activeScenario, sessionDurationSec]);

  // Reset zoom to full session if reveal is turned off while zoomed to a scenario
  useEffect(() => {
    if (!canReveal && focusedScenarioId !== 'all') {
      onChangeFocusedScenario('all');
    }
  }, [canReveal, focusedScenarioId, onChangeFocusedScenario]);

  // Filtered lifelines (global filters + class toggles)
  const filteredLifelines = useMemo(() => {
    return lifelines.filter((l) => {
      if (!sideToggles[l.side]) return false;
      if (l.max_qty < minQty) return false;
      const life = Math.max(0, l.t_end - l.t_start);
      if (life < minLifetimeSec) return false;
      if (participantFilter !== 'ALL' && l.participant_id !== participantFilter) return false;

      if (canReveal) {
        const cls = classifyLifeline(l, scenarioById);
        if (!classToggles[cls]) return false;
        const scn = l.scenario_id ? scenarioById.get(l.scenario_id) : undefined;
        if (labelFilter !== 'ALL' && scn?.ground_truth_label !== labelFilter) return false;
        if (assocFilter !== 'ALL' && scn?.event_association !== assocFilter) return false;
        if (diffFilter !== 'ALL' && scn?.difficulty !== diffFilter) return false;
      }
      return true;
    });
  }, [
    lifelines,
    sideToggles,
    minQty,
    minLifetimeSec,
    participantFilter,
    canReveal,
    scenarioById,
    classToggles,
    labelFilter,
    assocFilter,
    diffFilter,
  ]);

  // Lifelines intersecting visible X window [zoomRange[0], zoomRange[1]]
  const windowLifelines = useMemo(() => {
    const [a, b] = zoomRange;
    return filteredLifelines.filter((l) => l.t_end >= a && l.t_start <= b);
  }, [filteredLifelines, zoomRange]);

  // Auto-fit Y-axis to visible window (snapshots + active lifelines in Micro LOD)
  const priceBounds = useMemo(() => {
    const [a, b] = zoomRange;
    let lo = Infinity;
    let hi = -Infinity;

    for (const snap of bookSnapshots) {
      if (snap.snapshot_timestamp_sec >= a && snap.snapshot_timestamp_sec <= b) {
        lo = Math.min(lo, snap.best_bid_price);
        hi = Math.max(hi, snap.best_ask_price);
      }
    }

    if (isMicroLod) {
      for (const l of windowLifelines) {
        if (l.reject) continue;
        for (const seg of l.segments) {
          if (seg.t1 >= a && seg.t0 <= b) {
            lo = Math.min(lo, seg.price);
            hi = Math.max(hi, seg.price);
          }
        }
      }
    }

    if (!isFinite(lo) || !isFinite(hi)) {
      lo = 1280;
      hi = 1290;
    }

    const span = Math.max(0.4, hi - lo);
    const pad = isMicroLod ? Math.max(0.15, span * 0.12) : Math.max(0.45, span * 0.15);
    return { lo: lo - pad, hi: hi + pad };
  }, [bookSnapshots, zoomRange, isMicroLod, windowLifelines]);

  // Visible events count for live stats
  const visibleEventCount = useMemo(() => {
    let count = 0;
    for (const l of windowLifelines) count += l.events.length;
    return count;
  }, [windowLifelines]);

  const posVisibleCount = useMemo(
    () =>
      canReveal
        ? windowLifelines.filter(
            (l) => classifyLifeline(l, scenarioById) === 'POSITIVE_TEST'
          ).length
        : 0,
    [windowLifelines, canReveal, scenarioById]
  );

  const hardNegVisibleCount = useMemo(
    () =>
      canReveal
        ? windowLifelines.filter((l) => {
            const c = classifyLifeline(l, scenarioById);
            return c === 'HARD_NEGATIVE' || c === 'OTHER_CONTROL';
          }).length
        : 0,
    [windowLifelines, canReveal, scenarioById]
  );

  // Active book mode & cursor data
  const effectiveBookMode: 'snapshot' | 'replay' =
    bookModeOverride === 'auto' ? (activeScenario ? 'replay' : 'snapshot') : bookModeOverride;

  const activeCursorTime =
    pinnedTimeSec ??
    hoverTimeSec ??
    (activeScenario
      ? activeScenario.start_timestamp_sec + 4
      : scenarios[0]
        ? scenarios[0].start_timestamp_sec + 4
        : orderEvents[0]?.event_timestamp_sec ?? 1450);

  const nearestSnapshot = useMemo(
    () => getNearestSnapshotAtTime(bookSnapshots, activeCursorTime),
    [bookSnapshots, activeCursorTime]
  );

  const replayedBook = useMemo(() => {
    if (effectiveBookMode !== 'replay') {
      return { bids: [], asks: [], lastSequenceNumber: 0, activeOrderCount: 0 };
    }
    return replayOrderBookAtTime(orderEvents, activeCursorTime);
  }, [effectiveBookMode, orderEvents, activeCursorTime]);

  // Draw Main Chart (Macro Density Heatmap vs Micro Lifelines + Depth Backdrop + Vertical Cursor)
  useEffect(() => {
    const canvas = mainCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cssW = 860;
    const cssH = 420;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const styles = getComputedStyle(document.documentElement);
    const colInk = styles.getPropertyValue('--ink').trim();
    const colMut = styles.getPropertyValue('--mut').trim();
    const colLn = styles.getPropertyValue('--ln').trim();
    const colBuy = styles.getPropertyValue('--buy').trim();
    const colSell = styles.getPropertyValue('--sell').trim();
    const colFlag = styles.getPropertyValue('--flag').trim();
    const colLook = styles.getPropertyValue('--look').trim();
    const colFail = styles.getPropertyValue('--fail').trim();

    ctx.clearRect(0, 0, cssW, cssH);

    const padL = 62;
    const padR = 14;
    const padT = 18;
    const padB = 30;
    const plotW = cssW - padL - padR;
    const plotH = cssH - padT - padB;
    const [a, b] = zoomRange;
    const { lo, hi } = priceBounds;

    const X = (t: number) => padL + ((t - a) / Math.max(0.001, b - a)) * plotW;
    const Y = (p: number) => padT + ((hi - p) / Math.max(0.001, hi - lo)) * plotH;

    // Grid & Y-axis ticks
    ctx.font = '11px "IBM Plex Mono", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 5; i++) {
      const p = lo + ((hi - lo) * i) / 5;
      const y = Y(p);
      ctx.strokeStyle = colLn;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(cssW - padR, y);
      ctx.stroke();
      ctx.fillStyle = colMut;
      ctx.fillText(p.toFixed(2), padL - 8, y);
    }

    // X-axis ticks
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let i = 0; i <= 5; i++) {
      const t = a + ((b - a) * i) / 5;
      ctx.fillStyle = colMut;
      ctx.fillText(formatSessionClock(t).slice(0, 8), X(t), cssH - padB + 8);
    }

    // Clip to plot area
    ctx.save();
    ctx.beginPath();
    ctx.rect(padL, padT, plotW, plotH);
    ctx.clip();

    if (!isMicroLod) {
      // MACRO LOD (> 2 min): 2D Density Heatmap (time bin × price bin, shaded by resting qty)
      const cols = 64;
      const rows = 26;
      const gridQty = new Float64Array(cols * rows);
      const gridPos = new Float64Array(cols * rows);
      const gridHard = new Float64Array(cols * rows);

      const dt = (b - a) / cols;
      const dp = (hi - lo) / rows;

      for (const l of windowLifelines) {
        if (l.reject) continue;
        const cls = canReveal ? classifyLifeline(l, scenarioById) : 'BASELINE';
        if (cls === 'BASELINE' && baselineOpacity === 0) continue;

        const baseWeight = cls === 'BASELINE' ? baselineOpacity / 100 : 1;

        for (const seg of l.segments) {
          if (seg.t1 < a || seg.t0 > b) continue;
          const c0 = Math.max(0, Math.floor((Math.max(a, seg.t0) - a) / dt));
          const c1 = Math.min(cols - 1, Math.floor((Math.min(b, seg.t1) - a) / dt));
          const rIdx = Math.floor((hi - seg.price) / dp);
          if (rIdx < 0 || rIdx >= rows) continue;

          for (let c = c0; c <= c1; c++) {
            const idx = rIdx * cols + c;
            gridQty[idx] += seg.qty * baseWeight;
            if (canReveal && cls === 'POSITIVE_TEST') gridPos[idx] += seg.qty;
            if (canReveal && (cls === 'HARD_NEGATIVE' || cls === 'OTHER_CONTROL')) {
              gridHard[idx] += seg.qty;
            }
          }
        }
      }

      let maxCell = 1;
      for (let i = 0; i < gridQty.length; i++) {
        if (gridQty[i] > maxCell) maxCell = gridQty[i];
      }

      const cellW = plotW / cols;
      const cellH = plotH / rows;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const idx = r * cols + c;
          const q = gridQty[idx];
          if (q <= 0) continue;
          const norm = Math.pow(q / maxCell, 0.55);
          let fill = colSell;
          let alpha = Math.min(0.85, 0.08 + norm * 0.72);

          if (canReveal) {
            if (gridPos[idx] > 0) {
              fill = colFlag;
              alpha = Math.min(0.9, 0.3 + norm * 0.6);
            } else if (gridHard[idx] > 0) {
              fill = colLook;
              alpha = Math.min(0.85, 0.25 + norm * 0.55);
            } else if (hoveredClass && hoveredClass !== 'BASELINE') {
              alpha *= 0.25;
            }
          }

          ctx.fillStyle = fill;
          ctx.globalAlpha = alpha;
          ctx.fillRect(padL + c * cellW, padT + r * cellH, cellW + 0.5, cellH + 0.5);
        }
      }
      ctx.globalAlpha = 1;

      // Scenario markers only when revealed
      if (canReveal) {
        for (const scn of scenarios) {
          if (scn.end_timestamp_sec < a || scn.start_timestamp_sec > b) continue;
          const sx1 = X(Math.max(a, scn.start_timestamp_sec));
          const sx2 = Math.max(sx1 + 4, X(Math.min(b, scn.end_timestamp_sec)));
          const isPos = scn.evaluation_label === 'POSITIVE_TEST';
          const markerCol = isPos ? colFlag : colLook;

          ctx.fillStyle = markerCol;
          ctx.globalAlpha = 0.14;
          ctx.fillRect(sx1, padT, sx2 - sx1, plotH);

          ctx.globalAlpha = 0.95;
          ctx.strokeStyle = markerCol;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(sx1, padT);
          ctx.lineTo(sx1, padT + 14);
          ctx.stroke();

          ctx.font = '600 10px "IBM Plex Mono", monospace';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.fillText(scn.scenario_id, sx1 + 3, padT + 2);
        }
        ctx.globalAlpha = 1;
      }
    } else {
      // MICRO LOD (<= 2 min): Optional Depth Heatmap Backdrop + Individual Order Lifelines
      if (showDepthBackdrop) {
        const cols = 48;
        const rows = 28;
        const bidDepthGrid = new Float64Array(cols * rows);
        const askDepthGrid = new Float64Array(cols * rows);
        const dt = (b - a) / cols;
        const dp = (hi - lo) / rows;

        for (const l of windowLifelines) {
          if (l.reject) continue;
          for (const seg of l.segments) {
            if (seg.t1 < a || seg.t0 > b) continue;
            const c0 = Math.max(0, Math.floor((Math.max(a, seg.t0) - a) / dt));
            const c1 = Math.min(cols - 1, Math.floor((Math.min(b, seg.t1) - a) / dt));
            const rIdx = Math.floor((hi - seg.price) / dp);
            if (rIdx < 0 || rIdx >= rows) continue;
            for (let c = c0; c <= c1; c++) {
              const idx = rIdx * cols + c;
              if (l.side === 'BUY') bidDepthGrid[idx] += seg.qty;
              else askDepthGrid[idx] += seg.qty;
            }
          }
        }

        let maxD = 1;
        for (let i = 0; i < bidDepthGrid.length; i++) {
          maxD = Math.max(maxD, bidDepthGrid[i], askDepthGrid[i]);
        }

        const cellW = plotW / cols;
        const cellH = plotH / rows;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const idx = r * cols + c;
            const bq = bidDepthGrid[idx];
            const aq = askDepthGrid[idx];
            if (bq > 0) {
              ctx.fillStyle = colBuy;
              ctx.globalAlpha = Math.min(0.18, 0.03 + Math.sqrt(bq / maxD) * 0.15);
              ctx.fillRect(padL + c * cellW, padT + r * cellH, cellW + 0.5, cellH + 0.5);
            }
            if (aq > 0) {
              ctx.fillStyle = colSell;
              ctx.globalAlpha = Math.min(0.18, 0.03 + Math.sqrt(aq / maxD) * 0.15);
              ctx.fillRect(padL + c * cellW, padT + r * cellH, cellW + 0.5, cellH + 0.5);
            }
          }
        }
        ctx.globalAlpha = 1;
      }

      // Draw scenario highlight bands if revealed
      if (canReveal) {
        for (const scn of scenarios) {
          if (scn.end_timestamp_sec < a || scn.start_timestamp_sec > b) continue;
          const sx1 = X(Math.max(a, scn.start_timestamp_sec));
          const sx2 = X(Math.min(b, scn.end_timestamp_sec));
          ctx.fillStyle =
            scn.evaluation_label === 'POSITIVE_TEST' ? colFlag : colLook;
          ctx.globalAlpha = 0.06;
          ctx.fillRect(sx1, padT, Math.max(2, sx2 - sx1), plotH);
        }
        ctx.globalAlpha = 1;
      }

      const drawOrder = (l: RebuiltOrderLifeline) => {
        const cls = canReveal ? classifyLifeline(l, scenarioById) : 'BASELINE';
        const isParticipantMatch =
          highlightParticipantId && l.participant_id === highlightParticipantId;
        const isClicked = clickedOrderId === l.order_id;

        let color = l.side === 'BUY' ? colBuy : colSell;
        let alpha = 0.65;
        let lw = 1.6; // Constant stroke width in CSS pixels

        if (canReveal) {
          if (cls === 'POSITIVE_TEST') {
            color = colFlag;
            alpha = 0.95;
            lw = 2.0 + Math.min(2.4, l.max_qty / 700);
          } else if (cls === 'HARD_NEGATIVE') {
            color = colLook;
            alpha = 0.92;
            lw = 2.0 + Math.min(1.8, l.max_qty / 800);
          } else if (cls === 'OTHER_CONTROL') {
            color = colBuy;
            alpha = 0.85;
            lw = 2.0;
          } else {
            color = colMut;
            alpha = baselineOpacity / 100;
            lw = 1.25;
          }

          if (hoveredClass && cls !== hoveredClass) {
            alpha = Math.min(alpha, 0.09);
          } else if (hoveredClass && cls === hoveredClass) {
            alpha = Math.max(alpha, 0.95);
            lw = Math.max(lw, 2.4);
          }
        }

        if (isParticipantMatch || isClicked) {
          alpha = 1;
          lw = Math.max(lw, 2.8);
        }

        if (alpha <= 0.01) return;

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = lw;
        ctx.lineCap = 'round';

        // Constant minimum pixel bar length (6px) so short orders stay visible
        const MIN_BAR_PX = 6;
        if (l.segments.length > 0) {
          ctx.beginPath();
          l.segments.forEach((seg, idx) => {
            const x1 = X(Math.max(a, seg.t0));
            const rawX2 = X(Math.min(b, seg.t1));
            const x2 = idx === l.segments.length - 1 ? Math.max(rawX2, x1 + MIN_BAR_PX) : rawX2;
            const y = Y(seg.price);
            if (idx === 0) ctx.moveTo(x1, y);
            else ctx.lineTo(x1, y);
            ctx.lineTo(x2, y);
          });
          ctx.stroke();
        }

        // Constant glyph sizes in CSS pixels, gated by Event Marks toggles
        if (markToggles.AMEND) {
          for (const am of l.amends) {
            if (am.t < a || am.t > b) continue;
            const ax = X(am.t);
            const ay = Y(am.to_price);
            ctx.beginPath();
            ctx.moveTo(ax, ay - 3.5);
            ctx.lineTo(ax + 3.5, ay);
            ctx.lineTo(ax, ay + 3.5);
            ctx.lineTo(ax - 3.5, ay);
            ctx.closePath();
            ctx.fillStyle = darkMode ? '#0E1424' : '#FFFFFF';
            ctx.fill();
            ctx.lineWidth = 1.4;
            ctx.stroke();
          }
        }

        if (markToggles.PARTIAL_FILL) {
          for (const pf of l.partial_fills) {
            if (pf.t < a || pf.t > b) continue;
            const px = X(pf.t);
            const py = Y(pf.price);
            ctx.beginPath();
            ctx.arc(px, py, 3.4, 0, Math.PI * 2);
            ctx.fillStyle = darkMode ? '#0E1424' : '#FFFFFF';
            ctx.fill();
            ctx.lineWidth = 1.6;
            ctx.stroke();
          }
        }

        if (markToggles.FILL && l.final_fill && l.final_fill.t >= a && l.final_fill.t <= b) {
          const fx = Math.max(X(l.final_fill.t), X(Math.max(a, l.t_start)) + MIN_BAR_PX);
          const fy = Y(l.final_fill.price);
          ctx.beginPath();
          ctx.arc(fx, fy, 3.6, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
        }

        if (markToggles.CANCEL && l.cancel && l.cancel.t >= a && l.cancel.t <= b) {
          const cx = Math.max(X(l.cancel.t), X(Math.max(a, l.t_start)) + MIN_BAR_PX);
          const cy = Y(l.cancel.price);
          ctx.beginPath();
          ctx.moveTo(cx, cy - 4);
          ctx.lineTo(cx, cy + 4);
          ctx.lineWidth = Math.max(1.5, lw * 0.85);
          ctx.stroke();
        }

        if (markToggles.REJECT && l.reject && l.reject.t >= a && l.reject.t <= b) {
          const rx = X(l.reject.t);
          const ry = Y(Math.max(lo, Math.min(hi, l.reject.price)));
          ctx.strokeStyle = colFail;
          ctx.lineWidth = 1.7;
          ctx.beginPath();
          ctx.moveTo(rx - 3.5, ry - 3.5);
          ctx.lineTo(rx + 3.5, ry + 3.5);
          ctx.moveTo(rx + 3.5, ry - 3.5);
          ctx.lineTo(rx - 3.5, ry + 3.5);
          ctx.stroke();
        }

        ctx.restore();
      };

      const bg = windowLifelines.filter((l) => !canReveal || !l.scenario_id);
      const fg = windowLifelines.filter((l) => canReveal && l.scenario_id);
      bg.forEach(drawOrder);
      fg.forEach(drawOrder);
    }

    // Mid-Price Polyline (always drawn on top in both Macro & Micro LOD)
    ctx.save();
    ctx.strokeStyle = colInk;
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    let started = false;
    for (const snap of bookSnapshots) {
      if (snap.snapshot_timestamp_sec < a || snap.snapshot_timestamp_sec > b) continue;
      const sx = X(snap.snapshot_timestamp_sec);
      const sy = Y(snap.mid_price);
      if (!started) {
        ctx.moveTo(sx, sy);
        started = true;
      } else {
        ctx.lineTo(sx, sy);
      }
    }
    ctx.stroke();
    ctx.restore();

    // Vertical Cursor Line at activeCursorTime (pinned or hovered)
    const cursorT = pinnedTimeSec ?? hoverTimeSec;
    if (cursorT != null && cursorT >= a && cursorT <= b) {
      const cx = X(cursorT);
      ctx.save();
      ctx.strokeStyle = pinnedTimeSec != null ? colFlag : colInk;
      ctx.lineWidth = pinnedTimeSec != null ? 1.6 : 1.1;
      ctx.setLineDash(pinnedTimeSec != null ? [] : [4, 3]);
      ctx.beginPath();
      ctx.moveTo(cx, padT);
      ctx.lineTo(cx, padT + plotH);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore(); // end clip
  }, [
    zoomRange,
    priceBounds,
    isMicroLod,
    windowLifelines,
    bookSnapshots,
    canReveal,
    scenarios,
    scenarioById,
    baselineOpacity,
    hoveredClass,
    showDepthBackdrop,
    markToggles,
    highlightParticipantId,
    clickedOrderId,
    pinnedTimeSec,
    hoverTimeSec,
    darkMode,
  ]);

  // Draw Overview Strip (0..sessionDurationSec) with draggable brush & revealed scenario ticks
  useEffect(() => {
    const canvas = overviewCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cssW = 860;
    const cssH = 56;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const styles = getComputedStyle(document.documentElement);
    const colInk = styles.getPropertyValue('--ink').trim();
    const colMut = styles.getPropertyValue('--mut').trim();
    const colLn = styles.getPropertyValue('--ln').trim();
    const colFlag = styles.getPropertyValue('--flag').trim();
    const colLook = styles.getPropertyValue('--look').trim();

    ctx.clearRect(0, 0, cssW, cssH);

    const padL = 62;
    const padR = 14;
    const plotW = cssW - padL - padR;

    const X = (t: number) => padL + (t / sessionDurationSec) * plotW;

    let lo = Infinity;
    let hi = -Infinity;
    for (const s of bookSnapshots) {
      lo = Math.min(lo, s.mid_price);
      hi = Math.max(hi, s.mid_price);
    }
    const Y = (p: number) => 6 + ((hi - p) / Math.max(0.1, hi - lo)) * (cssH - 14);

    // Scenario ticks when revealed
    if (canReveal) {
      for (const scn of scenarios) {
        const sx1 = X(scn.start_timestamp_sec);
        const sx2 = Math.max(sx1 + 3, X(scn.end_timestamp_sec));
        ctx.fillStyle = scn.evaluation_label === 'POSITIVE_TEST' ? colFlag : colLook;
        ctx.globalAlpha = 0.45;
        ctx.fillRect(sx1, 2, sx2 - sx1, cssH - 4);
      }
      ctx.globalAlpha = 1;
    }

    // Full session mid sparkline
    ctx.strokeStyle = colMut;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    bookSnapshots.forEach((s, i) => {
      const sx = X(s.snapshot_timestamp_sec);
      const sy = Y(s.mid_price);
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    ctx.stroke();

    // Unselected mask + Brush rectangle
    const bx1 = X(zoomRange[0]);
    const bx2 = X(zoomRange[1]);

    ctx.fillStyle = colLn;
    ctx.globalAlpha = 0.45;
    ctx.fillRect(padL, 0, bx1 - padL, cssH);
    ctx.fillRect(bx2, 0, padL + plotW - bx2, cssH);
    ctx.globalAlpha = 1;

    // Brush border + handles
    ctx.strokeStyle = colInk;
    ctx.lineWidth = 1.6;
    ctx.strokeRect(bx1, 1, Math.max(4, bx2 - bx1), cssH - 2);

    ctx.fillStyle = colInk;
    ctx.fillRect(bx1 - 2, cssH / 2 - 10, 4, 20);
    ctx.fillRect(bx2 - 2, cssH / 2 - 10, 4, 20);

    // Left label
    ctx.fillStyle = colMut;
    ctx.font = '10px "IBM Plex Mono", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      sessionDurationSec >= 3600
        ? `${(sessionDurationSec / 3600).toFixed(sessionDurationSec % 3600 === 0 ? 0 : 1)}h`
        : `${Math.round(sessionDurationSec / 60)}m`,
      padL - 8,
      cssH / 2
    );
  }, [bookSnapshots, zoomRange, canReveal, scenarios, darkMode, sessionDurationSec]);

  // Main Canvas pointer helpers
  const canvasCoordsToTimePrice = (clientX: number, clientY: number) => {
    const canvas = mainCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const mx = ((clientX - rect.left) / rect.width) * 860;
    const my = ((clientY - rect.top) / rect.height) * 420;
    const padL = 62;
    const padR = 14;
    const padT = 18;
    const padB = 30;
    const plotW = 860 - padL - padR;
    const plotH = 420 - padT - padB;
    const [a, b] = zoomRange;
    const { lo, hi } = priceBounds;

    const t = a + ((mx - padL) / plotW) * (b - a);
    const p = hi - ((my - padT) / plotH) * (hi - lo);
    return {
      mx,
      my,
      rect,
      t: Math.max(a, Math.min(b, t)),
      p,
      inPlot: mx >= padL && mx <= 860 - padR && my >= padT && my <= 420 - padB,
    };
  };

  const findNearestLifeline = (mx: number, my: number): RebuiltOrderLifeline | null => {
    if (!isMicroLod) return null;
    const padL = 62;
    const padR = 14;
    const padT = 18;
    const padB = 30;
    const plotW = 860 - padL - padR;
    const plotH = 420 - padT - padB;
    const [a, b] = zoomRange;
    const { lo, hi } = priceBounds;

    const X = (t: number) => padL + ((t - a) / Math.max(0.001, b - a)) * plotW;
    const Y = (p: number) => padT + ((hi - p) / Math.max(0.001, hi - lo)) * plotH;

    let best: RebuiltOrderLifeline | null = null;
    let bestDist = 11;

    const ordered = windowLifelines.slice().sort((x, y) => {
      const xs = canReveal && x.scenario_id ? 1 : 0;
      const ys = canReveal && y.scenario_id ? 1 : 0;
      return ys - xs;
    });

    for (const l of ordered) {
      for (const seg of l.segments) {
        const x1 = X(Math.max(a, seg.t0));
        const x2 = Math.max(x1 + 6, X(Math.min(b, seg.t1)));
        const y = Y(seg.price);
        if (mx >= x1 - 4 && mx <= x2 + 4) {
          const d = Math.abs(my - y);
          if (d < bestDist) {
            bestDist = d;
            best = l;
          }
        }
      }
      if (best && canReveal && best.scenario_id) break;
    }
    return best;
  };

  const handleMainMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = canvasCoordsToTimePrice(e.clientX, e.clientY);
    if (!coords || !coords.inPlot) {
      setHoverTimeSec(null);
      setHoveredOrder(null);
      return;
    }
    setHoverTimeSec(coords.t);
    const hit = findNearestLifeline(coords.mx, coords.my);
    if (hit) {
      const scn = hit.scenario_id ? scenarioById.get(hit.scenario_id) : undefined;
      setHoveredOrder({
        lifeline: hit,
        scenario: scn,
        x: e.clientX - coords.rect.left,
        y: e.clientY - coords.rect.top,
      });
    } else {
      setHoveredOrder(null);
    }
  };

  const handleMainClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = canvasCoordsToTimePrice(e.clientX, e.clientY);
    if (!coords || !coords.inPlot) return;

    // In Macro LOD, clicking near a revealed scenario marker jumps right into it
    if (!isMicroLod && canReveal) {
      const hitScn = scenarios.find(
        (s) => coords.t >= s.start_timestamp_sec - 12 && coords.t <= s.end_timestamp_sec + 12
      );
      if (hitScn) {
        onChangeFocusedScenario(hitScn.scenario_id);
        return;
      }
    }

    setPinnedTimeSec(coords.t);
    const hit = findNearestLifeline(coords.mx, coords.my);
    if (hit) {
      setClickedOrderId(hit.order_id);
      setClickedOrderPrice(hit.final_price);
    } else {
      setClickedOrderId(null);
      setClickedOrderPrice(null);
    }
  };

  const handleMainWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const coords = canvasCoordsToTimePrice(e.clientX, e.clientY);
    if (!coords || !coords.inPlot) return;

    const [a, b] = zoomRange;
    const span = b - a;
    const factor = e.deltaY > 0 ? 1.25 : 0.78;
    const nextSpan = Math.max(10, Math.min(sessionDurationSec, span * factor));
    const ratio = (coords.t - a) / span;
    let na = coords.t - ratio * nextSpan;
    let nb = na + nextSpan;
    if (na < 0) {
      na = 0;
      nb = Math.min(sessionDurationSec, nextSpan);
    }
    if (nb > sessionDurationSec) {
      nb = sessionDurationSec;
      na = Math.max(0, sessionDurationSec - nextSpan);
    }
    setZoomRange([na, nb]);
  };

  // Overview Strip Brush Pointer Handlers
  const overviewXToTime = (clientX: number) => {
    const canvas = overviewCanvasRef.current;
    if (!canvas) return 0;
    const rect = canvas.getBoundingClientRect();
    const mx = ((clientX - rect.left) / rect.width) * 860;
    const padL = 62;
    const padR = 14;
    const plotW = 860 - padL - padR;
    return Math.max(0, Math.min(sessionDurationSec, ((mx - padL) / plotW) * sessionDurationSec));
  };

  const handleOverviewMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const t = overviewXToTime(e.clientX);
    const [a, b] = zoomRange;
    const handleTol = Math.max(10, sessionDurationSec * 0.015); // seconds tolerance for handle hit

    if (Math.abs(t - a) <= handleTol) {
      brushDragRef.current = { mode: 'left', startX: t, origRange: [a, b] };
    } else if (Math.abs(t - b) <= handleTol) {
      brushDragRef.current = { mode: 'right', startX: t, origRange: [a, b] };
    } else if (t > a && t < b) {
      brushDragRef.current = { mode: 'move', startX: t, origRange: [a, b] };
    } else {
      brushDragRef.current = { mode: 'create', startX: t, origRange: [a, b] };
    }
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const drag = brushDragRef.current;
      if (!drag) return;
      const t = overviewXToTime(e.clientX);
      const [oa, ob] = drag.origRange;
      const span = ob - oa;

      if (drag.mode === 'move') {
        const dt = t - drag.startX;
        let na = oa + dt;
        let nb = ob + dt;
        if (na < 0) {
          na = 0;
          nb = span;
        }
        if (nb > sessionDurationSec) {
          nb = sessionDurationSec;
          na = sessionDurationSec - span;
        }
        setZoomRange([na, nb]);
      } else if (drag.mode === 'left') {
        setZoomRange([Math.max(0, Math.min(ob - 12, t)), ob]);
      } else if (drag.mode === 'right') {
        setZoomRange([oa, Math.min(sessionDurationSec, Math.max(oa + 12, t))]);
      } else if (drag.mode === 'create') {
        const minT = Math.min(drag.startX, t);
        const maxT = Math.max(drag.startX, t);
        if (maxT - minT >= 12) setZoomRange([minT, maxT]);
      }
    };
    const onUp = () => {
      brushDragRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [sessionDurationSec]);

  // 3-Series Order Lifetime Histogram
  const histogramData = useMemo(() => {
    const edges = [0.5, 2, 5, 15, 60, Infinity];
    const labels = ['<0.5s', '0.5–2s', '2–5s', '5–15s', '15–60s', '>60s'];
    const base = [0, 0, 0, 0, 0, 0];
    const hardNeg = [0, 0, 0, 0, 0, 0];
    const pos = [0, 0, 0, 0, 0, 0];

    for (const l of filteredLifelines) {
      if (l.reject) continue;
      const life = Math.max(0.05, l.t_end - l.t_start);
      const bucket = edges.findIndex((ed) => life < ed);
      const cls = classifyLifeline(l, scenarioById);
      if (cls === 'POSITIVE_TEST') pos[bucket]++;
      else if (cls === 'HARD_NEGATIVE' || cls === 'OTHER_CONTROL') hardNeg[bucket]++;
      else base[bucket]++;
    }

    const sum = (arr: number[]) => arr.reduce((s, v) => s + v, 0) || 1;
    const nBase = sum(base);
    const nHard = sum(hardNeg);
    const nPos = sum(pos);

    return labels.map((lbl, idx) => ({
      label: lbl,
      basePct: (base[idx] / nBase) * 100,
      hardNegPct: (hardNeg[idx] / nHard) * 100,
      posPct: (pos[idx] / nPos) * 100,
    }));
  }, [filteredLifelines, scenarioById]);

  // Fact rows around visible window / pinned cursor
  const windowEvents = useMemo(() => {
    const [a, b] = isMicroLod
      ? zoomRange
      : activeScenario
        ? [activeScenario.start_timestamp_sec - 4, activeScenario.end_timestamp_sec + 4]
        : zoomRange;
    const q = eventSearch.trim().toLowerCase();

    return orderEvents
      .filter((ev) => ev.event_timestamp_sec >= a && ev.event_timestamp_sec <= b)
      .filter((ev) => eventTypeFilter === 'ALL' || ev.event_type === eventTypeFilter)
      .filter(
        (ev) =>
          !q ||
          ev.order_id.toLowerCase().includes(q) ||
          ev.participant_id.toLowerCase().includes(q) ||
          (ev.reason_code ?? '').toLowerCase().includes(q)
      )
      .slice(0, 40);
  }, [orderEvents, isMicroLod, zoomRange, activeScenario, eventTypeFilter, eventSearch]);

  const toggleClassBtn = (cls: ClassFilterBucket, label: string, colorVar: string) => {
    const active = classToggles[cls];
    return (
      <button
        key={cls}
        type="button"
        onClick={() => setClassToggles((prev) => ({ ...prev, [cls]: !prev[cls] }))}
        onMouseEnter={() => setHoveredClass(cls)}
        onMouseLeave={() => setHoveredClass(null)}
        aria-pressed={active}
        className={`inline-flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium rounded border transition-colors cursor-pointer whitespace-nowrap ${
          active
            ? 'bg-[var(--sf)] border-[var(--ink)] text-[var(--ink)]'
            : 'bg-transparent border-[var(--ln)] text-[var(--mut)] opacity-60'
        }`}
      >
        <span className="w-2 h-2 rounded-xs shrink-0" style={{ backgroundColor: colorVar }} />
        <span>{label}</span>
      </button>
    );
  };

  return (
    <div className="space-y-4">
      {/* Dynamic Live Stats Row */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-x-7 gap-y-2">
          <div>
            <div className="text-xs text-[var(--mut)]">Orders in window</div>
            <div className="text-xl font-bold font-mono-tabular text-[var(--ink)]">
              {windowLifelines.length.toLocaleString()}
              <span className="text-xs font-normal text-[var(--mut)] ml-1">
                / {filteredLifelines.length.toLocaleString()} filtered
              </span>
            </div>
          </div>
          <div>
            <div className="text-xs text-[var(--mut)]">Visible events</div>
            <div className="text-xl font-bold font-mono-tabular text-[var(--ink)]">
              {visibleEventCount.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-xs text-[var(--mut)]">Positive tests</div>
            <div className="text-xl font-bold font-mono-tabular text-[var(--flag)]">
              {canReveal ? posVisibleCount : 'Withheld'}
            </div>
          </div>
          <div>
            <div className="text-xs text-[var(--mut)]">Hard neg &amp; controls</div>
            <div className="text-xl font-bold font-mono-tabular text-[var(--look)]">
              {canReveal ? hardNegVisibleCount : 'Withheld'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono-tabular text-[var(--mut)]">
          <span>
            {isMicroLod
              ? `Micro LOD · Individual lifelines (${windowDuration.toFixed(0)}s)`
              : `Macro LOD · 2D density heatmap (${(windowDuration / 60).toFixed(1)}m)`}
          </span>
          {(zoomRange[0] > 0.5 || zoomRange[1] < sessionDurationSec - 0.5) && (
            <button
              type="button"
              onClick={() => {
                setZoomRange([0, sessionDurationSec]);
                onChangeFocusedScenario('all');
              }}
              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-sans font-medium rounded border border-[var(--ln)] bg-[var(--bg)] text-[var(--ink)] hover:bg-[var(--sf-alt)] cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              Reset{' '}
              {sessionDurationSec >= 3600
                ? `${(sessionDurationSec / 3600).toFixed(sessionDurationSec % 3600 === 0 ? 0 : 1)}h`
                : `${Math.round(sessionDurationSec / 60)}m`}
            </button>
          )}
        </div>
      </div>

      {/* Compact Grouped Toggles & Filters */}
      <div className="bg-[var(--bg)] border border-[var(--ln)] rounded-xl p-3 space-y-2.5">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {/* Side Group */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-medium text-[var(--mut)]">Side:</span>
            {(['BUY', 'SELL'] as Side[]).map((sd) => (
              <button
                key={sd}
                type="button"
                onClick={() => setSideToggles((p) => ({ ...p, [sd]: !p[sd] }))}
                aria-pressed={sideToggles[sd]}
                className={`px-2 py-1 text-[11px] font-mono-tabular font-semibold rounded border cursor-pointer ${
                  sideToggles[sd]
                    ? 'bg-[var(--sf)] border-[var(--ink)]'
                    : 'bg-transparent border-[var(--ln)] opacity-50'
                }`}
                style={{ color: sd === 'BUY' ? 'var(--buy)' : 'var(--sell)' }}
              >
                {sd}
              </button>
            ))}
          </div>

          {/* Event Marks Group */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-medium text-[var(--mut)]">Marks:</span>
            {(
              [
                ['AMEND', '◆ Amend'],
                ['PARTIAL_FILL', '○ Partial'],
                ['FILL', '● Fill'],
                ['CANCEL', '| Cancel'],
                ['REJECT', '× Reject'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setMarkToggles((p) => ({ ...p, [key]: !p[key] }))}
                aria-pressed={markToggles[key]}
                className={`px-2 py-1 text-[11px] font-mono-tabular rounded border cursor-pointer whitespace-nowrap ${
                  markToggles[key]
                    ? 'bg-[var(--sf)] border-[var(--ink)] text-[var(--ink)]'
                    : 'bg-transparent border-[var(--ln)] text-[var(--mut)] opacity-55'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Depth Backdrop Toggle in Micro LOD */}
          {isMicroLod && (
            <label className="inline-flex items-center gap-1.5 text-[11px] text-[var(--ink)] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showDepthBackdrop}
                onChange={(e) => setShowDepthBackdrop(e.target.checked)}
                className="w-3.5 h-3.5 accent-[var(--sell)]"
              />
              <span>Book depth backdrop</span>
            </label>
          )}
        </div>

        {/* Class Group + Baseline Opacity Slider (when revealed) */}
        {canReveal && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-2 border-t border-[var(--ln)]/70">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-medium text-[var(--mut)]">
                Class (hover to isolate):
              </span>
              {toggleClassBtn('POSITIVE_TEST', 'Positive tests', 'var(--flag)')}
              {toggleClassBtn('HARD_NEGATIVE', 'Hard negatives', 'var(--look)')}
              {toggleClassBtn('OTHER_CONTROL', 'Other controls', 'var(--buy)')}
              {toggleClassBtn('BASELINE', 'Baseline', 'var(--mut)')}
            </div>

            <label className="inline-flex items-center gap-2 text-[11px] text-[var(--mut)]">
              <span>Baseline opacity</span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={baselineOpacity}
                onChange={(e) => setBaselineOpacity(Number(e.target.value))}
                className="w-24 accent-[var(--sell)] cursor-pointer"
              />
              <span className="font-mono-tabular text-[var(--ink)] w-8">{baselineOpacity}%</span>
            </label>
          </div>
        )}

        {/* Filters Row: Instrument, Zoom-to-Scenario, Min Qty, Min Lifetime, Participant + Fine Label Filters */}
        <div className="flex flex-wrap items-end gap-2.5 pt-2 border-t border-[var(--ln)]/70">
          {instruments && instruments.length > 1 && onSelectInstrument && (
            <label className="block">
              <span className="block text-[11px] text-[var(--mut)] mb-0.5">Instrument</span>
              <select
                value={selectedInstrumentId ?? instruments[0].instrument_id}
                onChange={(e) => {
                  onSelectInstrument(e.target.value);
                  onChangeFocusedScenario('all');
                }}
                aria-label="Select simulated instrument"
                className="text-xs font-mono-tabular bg-[var(--sf)] text-[var(--ink)] border border-[var(--ln)] rounded-lg px-2 py-1.5 cursor-pointer font-semibold"
              >
                {instruments.map((inst) => (
                  <option key={inst.instrument_id} value={inst.instrument_id}>
                    {inst.symbol} ({inst.volatility_regime}/{inst.liquidity_regime})
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="min-w-[230px] flex-1 max-w-xs block">
            <span className="block text-[11px] text-[var(--mut)] mb-0.5">
              Jump brush to scenario (requires revealed key)
            </span>
            <select
              disabled={!canReveal}
              value={canReveal ? focusedScenarioId : 'all'}
              onChange={(e) => {
                const v = e.target.value;
                onChangeFocusedScenario(v);
                if (v === 'all') setZoomRange([0, sessionDurationSec]);
              }}
              className="w-full text-xs font-mono-tabular bg-[var(--sf)] text-[var(--ink)] border border-[var(--ln)] rounded-lg px-2 py-1.5 disabled:opacity-50 cursor-pointer"
            >
              <option value="all">
                Full session (09:15:00 – {formatSessionClock(sessionDurationSec).slice(0, 8)})
              </option>
              {scenarios.map((s) => (
                <option key={s.scenario_id} value={s.scenario_id}>
                  {s.scenario_id} · {s.evaluation_label === 'POSITIVE_TEST' ? 'POS' : 'NEG'} ·{' '}
                  {s.ground_truth_label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="block text-[11px] text-[var(--mut)] mb-0.5">Min qty</span>
            <select
              value={minQty}
              onChange={(e) => setMinQty(Number(e.target.value))}
              className="text-xs font-mono-tabular bg-[var(--sf)] text-[var(--ink)] border border-[var(--ln)] rounded-lg px-2 py-1.5 cursor-pointer"
            >
              <option value={0}>0+</option>
              <option value={100}>100+</option>
              <option value={250}>250+</option>
              <option value={500}>500+</option>
              <option value={1000}>1,000+</option>
            </select>
          </label>

          <label className="block">
            <span className="block text-[11px] text-[var(--mut)] mb-0.5">Min lifetime</span>
            <select
              value={minLifetimeSec}
              onChange={(e) => setMinLifetimeSec(Number(e.target.value))}
              className="text-xs font-mono-tabular bg-[var(--sf)] text-[var(--ink)] border border-[var(--ln)] rounded-lg px-2 py-1.5 cursor-pointer"
            >
              <option value={0}>All</option>
              <option value={1}>≥ 1s</option>
              <option value={5}>≥ 5s</option>
              <option value={15}>≥ 15s</option>
            </select>
          </label>

          <label className="block">
            <span className="block text-[11px] text-[var(--mut)] mb-0.5">Participant</span>
            <select
              value={participantFilter}
              onChange={(e) => setParticipantFilter(e.target.value)}
              className="text-xs font-mono-tabular bg-[var(--sf)] text-[var(--ink)] border border-[var(--ln)] rounded-lg px-2 py-1.5 cursor-pointer"
            >
              <option value="ALL">All ({allParticipants.length})</option>
              {allParticipants.map((pid) => (
                <option key={pid} value={pid}>
                  {pid}
                </option>
              ))}
            </select>
          </label>

          {canReveal && (
            <>
              <label className="block">
                <span className="block text-[11px] text-[var(--mut)] mb-0.5">Label</span>
                <select
                  value={labelFilter}
                  onChange={(e) => setLabelFilter(e.target.value as 'ALL' | GroundTruthLabel)}
                  className="text-xs font-mono-tabular bg-[var(--sf)] text-[var(--ink)] border border-[var(--ln)] rounded-lg px-2 py-1.5 cursor-pointer max-w-[170px]"
                >
                  <option value="ALL">All 7 labels</option>
                  {GT_LABELS.map((lb) => (
                    <option key={lb} value={lb}>
                      {lb}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="block text-[11px] text-[var(--mut)] mb-0.5">Association</span>
                <select
                  value={assocFilter}
                  onChange={(e) => setAssocFilter(e.target.value as 'ALL' | EventAssociation)}
                  className="text-xs font-mono-tabular bg-[var(--sf)] text-[var(--ink)] border border-[var(--ln)] rounded-lg px-2 py-1.5 cursor-pointer"
                >
                  <option value="ALL">All</option>
                  <option value="LINKED">LINKED</option>
                  <option value="COINCIDENTAL">COINCIDENTAL</option>
                  <option value="INDEPENDENT">INDEPENDENT</option>
                  <option value="NOT_APPLICABLE">NOT_APPLICABLE</option>
                </select>
              </label>

              <label className="block">
                <span className="block text-[11px] text-[var(--mut)] mb-0.5">Difficulty</span>
                <select
                  value={diffFilter}
                  onChange={(e) => setDiffFilter(e.target.value as 'ALL' | ScenarioDifficulty)}
                  className="text-xs font-mono-tabular bg-[var(--sf)] text-[var(--ink)] border border-[var(--ln)] rounded-lg px-2 py-1.5 cursor-pointer"
                >
                  <option value="ALL">All</option>
                  <option value="EASY">EASY</option>
                  <option value="MEDIUM">MEDIUM</option>
                  <option value="HARD">HARD</option>
                </select>
              </label>
            </>
          )}

          {highlightParticipantId && (
            <button
              type="button"
              onClick={onClearHighlightParticipant}
              className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-[var(--ln)] bg-[var(--sf)] text-[var(--ink)] cursor-pointer"
            >
              Clear {highlightParticipantId}
            </button>
          )}
        </div>
      </div>

      {/* Scenario Context Banner when zoomed to a scenario */}
      {activeScenario && (
        <div className="bg-[var(--bg)] border border-[var(--ln)] rounded-xl p-3 text-xs space-y-0.5">
          <div className="flex flex-wrap items-center gap-2 font-mono-tabular">
            <span
              className={`font-bold ${
                activeScenario.evaluation_label === 'POSITIVE_TEST'
                  ? 'text-[var(--flag)]'
                  : 'text-[var(--look)]'
              }`}
            >
              {activeScenario.scenario_id} · {activeScenario.evaluation_label}
            </span>
            <span className="text-[var(--mut)]">·</span>
            <span className="font-semibold text-[var(--ink)]">
              {activeScenario.ground_truth_label}
            </span>
            <span className="text-[var(--mut)]">·</span>
            <span className="text-[var(--mut)]">
              assoc: {activeScenario.event_association} · diff: {activeScenario.difficulty}
            </span>
          </div>
          <p className="text-[var(--ink)]">{activeScenario.label_rationale}</p>
        </div>
      )}

      {/* Main Chart + Side-by-Side Order Book Ladder */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_305px] gap-3 items-stretch">
        <div className="space-y-2 min-w-0">
          {/* Primary Canvas */}
          <div className="relative bg-[var(--sf)] border border-[var(--ln)] rounded-xl p-2">
            <canvas
              ref={mainCanvasRef}
              onMouseMove={handleMainMouseMove}
              onMouseLeave={() => {
                setHoverTimeSec(null);
                setHoveredOrder(null);
              }}
              onClick={handleMainClick}
              onWheel={handleMainWheel}
              className="w-full h-auto block cursor-crosshair"
              style={{ aspectRatio: '860 / 420' }}
            />

            {hoveredOrder && (
              <div
                className="pointer-events-none absolute z-20 max-w-xs bg-[var(--sf)] border border-[var(--ln)] rounded-lg p-2.5 text-xs shadow-sm"
                style={{
                  left: Math.min(Math.max(12, hoveredOrder.x + 14), 500),
                  top: Math.max(12, hoveredOrder.y - 12),
                }}
              >
                <div className="font-mono-tabular font-bold text-[var(--ink)]">
                  {hoveredOrder.lifeline.order_id} · {hoveredOrder.lifeline.side} ·{' '}
                  {hoveredOrder.lifeline.participant_id}
                </div>
                <div className="font-mono-tabular text-[11px] text-[var(--mut)] mt-0.5">
                  qty {hoveredOrder.lifeline.initial_qty} → {hoveredOrder.lifeline.status} ·{' '}
                  {hoveredOrder.lifeline.events.map((ev) => ev.event_type).join(' → ')}
                </div>
                {canReveal && hoveredOrder.scenario && (
                  <div
                    className={`mt-1 pt-1 border-t border-[var(--ln)] font-mono-tabular text-[11px] ${
                      hoveredOrder.scenario.evaluation_label === 'POSITIVE_TEST'
                        ? 'text-[var(--flag)]'
                        : 'text-[var(--look)]'
                    }`}
                  >
                    {hoveredOrder.scenario.scenario_id} ·{' '}
                    {hoveredOrder.scenario.ground_truth_label} ({hoveredOrder.scenario.difficulty})
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Overview Strip with Draggable Brush */}
          <div className="bg-[var(--sf)] border border-[var(--ln)] rounded-xl px-2 py-1.5">
            <canvas
              ref={overviewCanvasRef}
              onMouseDown={handleOverviewMouseDown}
              onDoubleClick={() => {
                setZoomRange([0, sessionDurationSec]);
                onChangeFocusedScenario('all');
              }}
              className="w-full h-auto block cursor-grab active:cursor-grabbing"
              style={{ aspectRatio: '860 / 56' }}
            />
            <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-1 text-[11px] text-[var(--mut)] font-mono-tabular">
              <span>
                Window: {formatSessionClock(zoomRange[0]).slice(0, 8)} –{' '}
                {formatSessionClock(zoomRange[1]).slice(0, 8)}
              </span>
              <span className="font-sans">
                Drag brush to pan, drag handles or scroll wheel to zoom X-axis, click chart to pin
                order book.
              </span>
            </div>
          </div>
        </div>

        {/* Order Book Ladder beside chart */}
        <OrderBookLadder
          cursorTimeSec={activeCursorTime}
          isPinned={pinnedTimeSec != null}
          onClearPin={() => {
            setPinnedTimeSec(null);
            setClickedOrderId(null);
            setClickedOrderPrice(null);
          }}
          bookMode={effectiveBookMode}
          onChangeBookMode={(m) => setBookModeOverride(m)}
          snapshot={nearestSnapshot}
          replayedBook={replayedBook}
          clickedOrderId={clickedOrderId}
          clickedOrderPrice={clickedOrderPrice}
          canReveal={canReveal}
          orderScenarioMap={orderScenarioMap}
          scenarioById={scenarioById}
        />
      </div>

      {/* 3-Series Order Lifetime Histogram */}
      <div className="pt-3 border-t border-[var(--ln)] space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-[var(--ink)]">
            Order lifetime distribution (filtered): Baseline vs Hard Negatives vs Positives
          </h3>
          {canReveal && (
            <div className="flex items-center gap-4 text-xs text-[var(--mut)]">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-[var(--sell)]/55" />
                Baseline
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-[var(--look)]" />
                Hard negatives
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-[var(--flag)]" />
                Positives
              </span>
            </div>
          )}
        </div>

        {!canReveal ? (
          <p className="text-xs text-[var(--mut)] py-2">
            Class-separated lifetime histogram requires the evaluator sidecar with ground truth
            revealed.
          </p>
        ) : (
          <>
            <svg
              viewBox="0 0 900 185"
              className="w-full h-auto block"
              role="img"
              aria-label="Normalized order lifetime histogram comparing baseline, hard negatives, and positives"
            >
              {[0, 25, 50].map((pct) => {
                const y = 148 - (pct / 60) * 126;
                return (
                  <g key={pct}>
                    <line x1="42" x2="888" y1={y} y2={y} stroke="var(--ln)" strokeWidth="1" />
                    <text
                      x="36"
                      y={y + 3}
                      textAnchor="end"
                      fill="var(--mut)"
                      fontSize="10"
                      fontFamily="IBM Plex Mono, monospace"
                    >
                      {pct}%
                    </text>
                  </g>
                );
              })}

              {histogramData.map((b, idx) => {
                const bw = 840 / histogramData.length;
                const x0 = 48 + idx * bw + 12;
                const hBase = Math.min(130, (b.basePct / 60) * 126);
                const hHard = Math.min(130, (b.hardNegPct / 60) * 126);
                const hPos = Math.min(130, (b.posPct / 60) * 126);

                return (
                  <g key={b.label}>
                    <rect
                      x={x0}
                      y={148 - hBase}
                      width="28"
                      height={hBase}
                      rx="3"
                      fill="var(--sell)"
                      fillOpacity="0.5"
                    />
                    <rect
                      x={x0 + 32}
                      y={148 - hHard}
                      width="28"
                      height={hHard}
                      rx="3"
                      fill="var(--look)"
                    />
                    <rect
                      x={x0 + 64}
                      y={148 - hPos}
                      width="28"
                      height={hPos}
                      rx="3"
                      fill="var(--flag)"
                    />
                    <text
                      x={x0 + 46}
                      y="168"
                      textAnchor="middle"
                      fill="var(--mut)"
                      fontSize="11"
                      fontFamily="IBM Plex Mono, monospace"
                    >
                      {b.label}
                    </text>
                  </g>
                );
              })}
            </svg>
            <p className="text-xs text-[var(--mut)]">
              Takeaway: Each class is normalized to 100% of its own group. Hard negatives overlap
              directly with positives in the 0.5–15s buckets, confirming lifetime alone is not a
              detector.
            </p>
          </>
        )}
      </div>

      {/* Fact Rows Around Active Window */}
      <div className="pt-3 border-t border-[var(--ln)] space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-[var(--ink)]">
              core.order_events in {isMicroLod ? 'zoomed window' : 'sample slice'}
            </h3>
            <p className="text-xs text-[var(--mut)]">
              {!canReveal && 'scenario_id & ground_truth_label are omitted.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={eventTypeFilter}
              onChange={(e) => setEventTypeFilter(e.target.value as 'ALL' | EventType)}
              aria-label="Filter by event_type"
              className="text-xs font-mono-tabular bg-[var(--bg)] text-[var(--ink)] border border-[var(--ln)] rounded-lg px-2.5 py-1.5 cursor-pointer"
            >
              <option value="ALL">All event_types</option>
              <option value="NEW">NEW</option>
              <option value="AMEND">AMEND</option>
              <option value="PARTIAL_FILL">PARTIAL_FILL</option>
              <option value="FILL">FILL</option>
              <option value="CANCEL">CANCEL</option>
              <option value="REJECT">REJECT</option>
            </select>
            <input
              type="search"
              value={eventSearch}
              onChange={(e) => setEventSearch(e.target.value)}
              placeholder="Search order_id / participant..."
              className="text-xs font-mono-tabular bg-[var(--bg)] text-[var(--ink)] border border-[var(--ln)] rounded-lg px-2.5 py-1.5 w-48"
            />
          </div>
        </div>

        <div className="overflow-x-auto border border-[var(--ln)] rounded-xl">
          <table className="w-full border-collapse text-xs font-mono-tabular min-w-[780px]">
            <thead>
              <tr className="bg-[var(--bg)] border-b border-[var(--ln)] text-[var(--mut)]">
                <th className="text-left px-3 py-2 font-medium">seq</th>
                <th className="text-left px-3 py-2 font-medium">event_timestamp</th>
                <th className="text-left px-3 py-2 font-medium">order_id</th>
                <th className="text-left px-3 py-2 font-medium">event_type</th>
                <th className="text-left px-3 py-2 font-medium">side</th>
                <th className="text-right px-3 py-2 font-medium">price</th>
                <th className="text-right px-3 py-2 font-medium">event_qty</th>
                <th className="text-right px-3 py-2 font-medium">rem_qty</th>
                <th className="text-left px-3 py-2 font-medium">participant</th>
                <th className="text-left px-3 py-2 font-medium">dq / reason</th>
                {canReveal && (
                  <th className="text-left px-3 py-2 font-medium">scenario (answer key)</th>
                )}
              </tr>
            </thead>
            <tbody>
              {windowEvents.map((ev) => {
                const scnMeta = canReveal ? orderScenarioMap[ev.order_id] : undefined;
                const scn = scnMeta ? scenarioById.get(scnMeta.scenario_id) : undefined;
                const rowTone =
                  scn?.evaluation_label === 'POSITIVE_TEST'
                    ? 'bg-[var(--flag)]/12'
                    : scn?.evaluation_label === 'NEGATIVE_CONTROL'
                      ? 'bg-[var(--look)]/14'
                      : '';

                return (
                  <tr
                    key={ev.event_id}
                    className={`border-b border-[var(--ln)]/60 hover:bg-[var(--sf-alt)] ${rowTone}`}
                  >
                    <td className="px-3 py-1.5 text-[var(--mut)]">{ev.sequence_number}</td>
                    <td className="px-3 py-1.5">{formatSessionClock(ev.event_timestamp_sec)}</td>
                    <td className="px-3 py-1.5">{ev.order_id}</td>
                    <td className="px-3 py-1.5 font-semibold">{ev.event_type}</td>
                    <td
                      className={`px-3 py-1.5 font-semibold ${
                        ev.side === 'BUY' ? 'text-[var(--buy)]' : 'text-[var(--sell)]'
                      }`}
                    >
                      {ev.side}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {ev.price != null ? ev.price.toFixed(2) : 'MKT'}
                    </td>
                    <td className="px-3 py-1.5 text-right">{ev.event_qty}</td>
                    <td className="px-3 py-1.5 text-right">{ev.remaining_qty}</td>
                    <td className="px-3 py-1.5">{ev.participant_id}</td>
                    <td className="px-3 py-1.5 text-[var(--mut)]">
                      {ev.data_quality_flag !== 'NORMAL' ? (
                        <span className="text-[var(--fail)] font-semibold">
                          {ev.data_quality_flag}
                        </span>
                      ) : ev.reason_code ? (
                        ev.reason_code
                      ) : (
                        'NORMAL'
                      )}
                    </td>
                    {canReveal && (
                      <td className="px-3 py-1.5">
                        {scn ? (
                          <span
                            className={
                              scn.evaluation_label === 'POSITIVE_TEST'
                                ? 'text-[var(--flag)] font-semibold'
                                : 'text-[var(--look)] font-semibold'
                            }
                          >
                            {scn.scenario_id} · {scnMeta?.role}
                          </span>
                        ) : (
                          <span className="text-[var(--mut)]">baseline</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
              {windowEvents.length === 0 && (
                <tr>
                  <td
                    colSpan={canReveal ? 11 : 10}
                    className="px-3 py-6 text-center text-[var(--mut)]"
                  >
                    No events match the active filters in this time window.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
