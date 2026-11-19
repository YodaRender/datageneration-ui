export type Side = 'BUY' | 'SELL';
export type EventType = 'NEW' | 'AMEND' | 'CANCEL' | 'PARTIAL_FILL' | 'FILL' | 'REJECT';
export type OrderType = 'LIMIT' | 'MARKET';
export type TimeInForce = 'DAY' | 'IOC' | 'GTC';
export type OrderStatus = 'NEW' | 'ACTIVE' | 'PARTIALLY_FILLED' | 'CANCELLED' | 'FILLED' | 'REJECTED';

export type ReasonCode =
  | 'SELF_MATCH_PREVENTION'
  | 'REPLACED'
  | 'IOC_REMAINDER'
  | 'MARKET_REMAINDER'
  | 'TOO_LATE_TO_CANCEL'
  | 'TOO_LATE_TO_AMEND'
  | 'INVALID_TICK'
  | 'INVALID_LOT'
  | 'OUTSIDE_PRICE_BAND'
  | 'INVALID_QUANTITY'
  | 'INVALID_AMEND_QTY';

export type DataQualityFlag = 'NORMAL' | 'DUPLICATE' | 'MISSING' | 'OUT_OF_ORDER' | 'INCONSISTENT';
export type AggressorSide = 'BUY' | 'SELL' | 'UNKNOWN';
export type ExecutionStatus = 'EXECUTED' | 'CORRECTED' | 'CANCELLED';
export type BookStatus = 'VALID' | 'CROSSED' | 'LOCKED' | 'EMPTY_BID' | 'EMPTY_ASK' | 'EMPTY';
export type InstrumentType = 'EQUITY' | 'FUTURE' | 'OPTION' | 'OTHER';
export type Regime = 'LOW' | 'MEDIUM' | 'HIGH';

export type EntityType = 'ORDER' | 'ACCOUNT' | 'PARTICIPANT' | 'INSTRUMENT' | 'SCENARIO';
export type ScoringStage = 'SUBMISSION' | 'IN_LIFECYCLE' | 'POST_EVENT';

export type GroundTruthLabel =
  | 'LARGE_ORDER_ONLY'
  | 'LAYERING_PATTERN'
  | 'SPOOFING_LIKE_SEQUENCE'
  | 'LEGITIMATE_LARGE_ORDER'
  | 'LEGITIMATE_MULTI_LEVEL_QUOTING'
  | 'CANCEL_WITHOUT_OPPOSITE_TRADE'
  | 'COINCIDENTAL_OPPOSITE_TRADE';

export type EvaluationLabel = 'POSITIVE_TEST' | 'NEGATIVE_CONTROL';
export type EventAssociation = 'LINKED' | 'COINCIDENTAL' | 'INDEPENDENT' | 'NOT_APPLICABLE';
export type ValidationStatus = 'PASS' | 'FAIL' | 'PENDING';
export type ScenarioDifficulty = 'EASY' | 'MEDIUM' | 'HARD';

export type ReportArtifactMode = 'model_input' | 'evaluator';
export type ClassColorGroup = 'POSITIVE' | 'HARD_NEGATIVE' | 'BASELINE';

export interface RunMetadata {
  run_id: string;
  random_seed: number;
  config_version: string;
  generator_version: string;
  scenario_version: string;
  config_hash: string;
  config_json: Record<string, unknown>;
  status: 'GENERATING' | 'VALIDATED' | 'FAILED' | 'EXPORTED';
  created_at: string;
  bundle_budget_kb: {
    model_input_kb: number;
    labels_sidecar_kb: number;
    max_budget_kb: number;
    total_session_events: number;
    embedded_events: number;
    baseline_sample_pct: number;
  };
  amend_split?: {
    requested: {
      qty_decrease_pct: number;
      price_change_pct: number;
      qty_increase_pct: number;
    };
    realised: {
      qty_decrease_pct: number;
      price_change_pct: number;
      qty_increase_pct: number;
      total_amends: number;
    };
  };
}

export interface InstrumentMaster {
  run_id: string;
  instrument_id: string;
  symbol: string;
  exchange: string;
  currency: string;
  tick_size: number;
  lot_size: number;
  price_band_low: number;
  price_band_high: number;
  session_open: string;
  session_close: string;
  instrument_type: InstrumentType;
  reference_price: number;
  volatility_regime: Regime;
  liquidity_regime: Regime;
}

export interface OrderEvent {
  run_id: string;
  event_id: string;
  scenario_id: string | null; // Stripped in model_input.order_events
  instrument_id: string;
  venue_id: string;
  event_timestamp_sec: number; // Seconds from session open (09:15:00)
  event_timestamp_iso: string;
  sequence_number: number;
  order_id: string;
  parent_order_id: string | null;
  participant_id: string;
  account_id: string;
  side: Side;
  event_type: EventType;
  price: number | null;
  order_qty: number;
  event_qty: number;
  remaining_qty: number;
  order_type: OrderType;
  time_in_force: TimeInForce;
  source_sequence: number;
  exchange_order_status: OrderStatus;
  status?: OrderStatus; // Optional DB view alias for exchange_order_status
  is_scenario_event: boolean; // Stripped in model_input.order_events
  data_quality_flag: DataQualityFlag;
  reason_code: ReasonCode | null;
  trade_id: string | null;
  is_engine_generated: boolean;
}

export interface OrderState {
  run_id: string;
  order_id: string;
  instrument_id: string;
  participant_id: string;
  account_id: string;
  side: Side;
  order_type: OrderType;
  time_in_force: TimeInForce;
  parent_order_id: string | null;
  limit_price: number | null;
  original_qty: number;
  amended_qty_delta: number;
  filled_qty: number;
  cancelled_qty: number;
  remaining_qty: number;
  creation_timestamp_sec: number;
  last_update_timestamp_sec: number;
  queue_priority_timestamp_sec: number;
  creation_timestamp_iso?: string;
  last_update_timestamp_iso?: string;
  queue_priority_timestamp_iso?: string;
  status: OrderStatus;
  scenario_id: string | null;
}

export interface RebuiltOrderLifeline {
  order_id: string;
  participant_id: string;
  account_id: string;
  side: Side;
  order_type: OrderType;
  time_in_force: TimeInForce;
  t_start: number;
  t_end: number;
  initial_price: number;
  final_price: number;
  initial_qty: number;
  max_qty: number;
  filled_qty: number;
  cancelled_qty: number;
  status: OrderStatus;
  has_dq_defect: boolean;
  events: OrderEvent[];
  segments: Array<{
    t0: number;
    t1: number;
    price: number;
    qty: number;
  }>;
  partial_fills: Array<{ t: number; price: number; qty: number; trade_id: string }>;
  final_fill: { t: number; price: number; qty: number; trade_id: string } | null;
  amends: Array<{ t: number; from_price: number; to_price: number; new_qty: number }>;
  cancel: { t: number; price: number; reason_code: ReasonCode | null } | null;
  reject: { t: number; price: number; reason_code: ReasonCode | null } | null;
  // Isolated label metadata (only populated in evaluator mode)
  scenario_id: string | null;
  role_in_scenario: string | null;
}

export interface Trade {
  run_id: string;
  trade_id: string;
  instrument_id: string;
  trade_timestamp_sec: number;
  trade_timestamp_iso?: string;
  price: number;
  quantity: number;
  buy_order_id: string;
  sell_order_id: string;
  buy_participant_id: string;
  sell_participant_id: string;
  aggressor_side: AggressorSide;
  scenario_id: string | null;
  execution_status: ExecutionStatus;
}

export interface BookSnapshot {
  run_id: string;
  snapshot_id: string;
  instrument_id: string;
  snapshot_timestamp_sec: number;
  snapshot_timestamp_iso?: string;
  sequence_number: number;
  best_bid_price: number;
  best_bid_qty: number;
  best_ask_price: number;
  best_ask_qty: number;
  spread: number;
  mid_price: number;
  bid_prices: number[];
  bid_depths: number[];
  bid_order_counts: number[];
  ask_prices: number[];
  ask_depths: number[];
  ask_order_counts: number[];
  bid_total_depth: number;
  ask_total_depth: number;
  book_status: BookStatus;
  data_quality_flag: DataQualityFlag;
}

export interface RestingBookOrder {
  order_id: string;
  participant_id: string;
  account_id: string;
  side: Side;
  price: number;
  remaining_qty: number;
  sequence_number: number;
}

export interface BookLadderLevel {
  price: number;
  total_qty: number;
  order_count: number;
  orders?: RestingBookOrder[]; // populated in event-replay mode
}

export type ClassFilterBucket = 'POSITIVE_TEST' | 'HARD_NEGATIVE' | 'OTHER_CONTROL' | 'BASELINE';

export interface ScenarioManifestRow {
  run_id: string;
  scenario_id: string;
  scenario_type: string;
  scenario_version: string;
  instrument_id: string;
  start_timestamp_sec: number;
  end_timestamp_sec: number;
  start_timestamp_iso: string;
  end_timestamp_iso: string;
  related_order_ids: string[];
  related_event_ids: string[];
  related_trade_ids: string[];
  intended_pattern: string;
  ground_truth_label: GroundTruthLabel;
  pattern_class: string | null;
  control_type: string | null;
  event_association: EventAssociation;
  evaluation_label: EvaluationLabel;
  difficulty: ScenarioDifficulty;
  label_rationale: string;
  expected_feature_behaviour: Record<string, string>;
  acceptance_criterion: Record<string, unknown>;
  validation_status: ValidationStatus;
  validation_reason: string | null;
  random_seed: number;
}

export interface SurveillanceFeatureRow {
  run_id: string;
  feature_row_id: number;
  feature_timestamp_sec: number;
  observation_start_sec: number;
  observation_end_sec: number;
  feature_timestamp_iso?: string;
  observation_start_iso?: string;
  observation_end_iso?: string;
  feature_name: string;
  feature_value_num: number | null;
  feature_value_cat: string | null;
  entity_type: EntityType;
  entity_id: string;
  feature_version: string;
  scoring_stage: ScoringStage;
  data_quality_status: 'OK' | 'DEGRADED' | 'MISSING';
  context: {
    side?: Side;
    cancelled_qty?: number;
    filled_qty?: number;
    cancel_latency_ms?: number;
    composite_score?: number;
    alert_triggered?: boolean;
    participant_id?: string;
    order_count?: number;
    instrument_id?: string;
  };
}

export interface ValidationResultRow {
  run_id: string;
  result_id: number;
  check_id: string;
  requirement_id: string | null;
  scope: 'RUN' | 'INSTRUMENT' | 'EVENT_STREAM' | 'ORDER_STATE' | 'BOOK_SNAPSHOTS' | 'SCENARIO_MANIFEST';
  scenario_id: string | null;
  status: ValidationStatus;
  message: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
  pass_rate_pct: number;
  checked_rows: number;
  passed_rows: number;
}

export interface SyntheticDataset {
  run_metadata: RunMetadata;
  instrument_master: InstrumentMaster;
  instruments?: InstrumentMaster[];
  // model_input.* layer (label-free)
  model_input: {
    order_events: OrderEvent[];
    order_state: OrderState[];
    trades: Trade[];
    book_snapshots: BookSnapshot[];
    surveillance_features: SurveillanceFeatureRow[];
  };
  // Isolated evaluator sidecar (never serialized into model_input bundle)
  evaluator_bundle: {
    scenario_manifest: ScenarioManifestRow[];
    validation_results: ValidationResultRow[];
    order_scenario_map: Record<string, { scenario_id: string; role: string }>;
    seeded_orders_passing_all_checks: { passed: number; total: number };
  };
}

export type SchemaLayerName = 'quality' | 'core' | 'analytics' | 'labels' | 'model_input';

export interface SchemaColumnDef {
  column_name: string;
  data_type: string;
  nullable: boolean;
  key_type?: 'PK' | 'FK' | 'PK/FK' | 'IDENTITY' | 'UNIQUE';
  references?: string;
  deferrable?: boolean;
  stripped_in_model_input?: boolean;
  note?: string;
}

export interface SchemaTableDef {
  id: string; // e.g. 'core.order_events'
  schema: SchemaLayerName;
  table_name: string;
  table_type: 'BASE TABLE' | 'VIEW';
  grain: string;
  description: string;
  columns: SchemaColumnDef[];
  constraints: string[];
  triggers?: string[];
  omitted_fk_note?: string;
  x: number;
  y: number;
}

export interface SchemaRelationEdge {
  from: string;
  to: string;
  label: string;
  kind: 'FK' | 'DEFERRABLE_FK' | 'OMITTED_FK' | 'VIEW_SOURCE';
}

export interface InstrumentConfigRow {
  instrument_id: string;
  symbol: string;
  exchange: string;
  currency: string;
  tick_size: number;
  lot_size: number;
  reference_price: number;
  volatility_regime: Regime;
  liquidity_regime: Regime;
}

export interface VolatilityRegimeParams {
  sigma_bps_per_sqrt_s: number;
  vol_of_vol: number;
  vol_persistence: number;
  activity_exponent: number;
}

export interface LiquidityRegimeParams {
  depth_scale: number;
  size_median: number;
  size_sigma: number;
  size_max: number;
  half_spread_ticks: number;
  offset_scale_ticks: number;
  seed_levels: number;
  seed_orders_per_level: number;
  rate_multiplier: number;
}

export type ScenarioId =
  | 'S01' | 'S02' | 'S03' | 'S04'
  | 'S05' | 'S06' | 'S07' | 'S08'
  | 'S09' | 'S10' | 'S11' | 'S12'
  | 'S13' | 'S14' | 'S15' | 'S16';

export type SharedKnobKey =
  | 'large_depth_multiple'
  | 'layer_count'
  | 'layer_price_step_ticks'
  | 'layer_volume_decay'
  | 'difficulty'
  | 'display_duration_s'
  | 'hold_duration_s'
  | 'partial_fill'
  | 'resting_time'
  | 'latency_jitter'
  | 'blend_actors';

export interface ScenarioDefinition {
  id: ScenarioId;
  name: string;
  group: 'Large-order patterns' | 'Layering patterns' | 'Spoofing-like sequences' | 'Benign controls';
  role: 'pattern' | 'control';
  script: string;
  family: string;
  category: string;
  desc: string;
  knobs: SharedKnobKey[];
  fixed: string[];
  extra?: string;
}

export interface SimulationConfig {
  session: {
    trading_date: string;
    timezone: string;
    run_duration_s: number;
  };
  market: {
    instrument_count: number;
    volatility_regime: Regime;
    liquidity_regime: Regime;
  };
  reproducibility: {
    random_seed: number;
  };
  instruments: InstrumentConfigRow[];
  event_rates: {
    background_events_per_second: number;
    cancel_rate: number;
    amend_rate: number;
    market_order_share: number;
    limit_ioc_share: number;
    participant_count: number;
    participant_zipf_exponent: number;
    amend_qty_decrease_share: number;
    amend_price_change_share: number;
    amend_qty_increase_share: number;
  };
  book: {
    snapshot_levels_n: number;
    snapshot_mode: 'TIME' | 'EVENT' | 'BOTH';
    snapshot_interval_ms: number;
    self_match_prevention: 'prevent-cancel-resting' | 'prevent-cancel-incoming' | 'allow';
    full_invariant_check_interval: number;
  };
  timing: {
    internal_precision: 'MICROSECOND' | 'MILLISECOND';
    export_precision: 'MICROSECOND' | 'MILLISECOND';
  };
  features: {
    depth_n: number;
    depth_band_pct: number;
    group_gap_ms: number;
    group_max_span_ms: number;
    trailing_window_ms: number;
    background_order_sample_rate: number;
  };
  scenario: {
    scenario_slot_s: number;
    warmup_frac: number;
    cooldown_frac: number;
    difficulty: 'easy' | 'medium' | 'hard' | 'mixed';
    large_depth_multiple_min: number;
    large_depth_multiple_max: number;
    layer_count: number;
    layer_price_step_ticks: number;
    layer_volume_decay: number;
    display_duration_s_min: number;
    display_duration_s_max: number;
    hold_duration_s_min: number;
    hold_duration_s_max: number;
    resting_time_distribution: 'lognormal' | 'uniform';
    resting_time_lognormal_mu: number;
    resting_time_lognormal_sigma: number;
    resting_time_min_s: number;
    resting_time_max_s: number;
    partial_fill_enabled: boolean;
    partial_fill_prob: number;
    partial_fill_min_ratio: number;
    partial_fill_max_ratio: number;
    latency_jitter_enabled: boolean;
    latency_jitter_ms_min: number;
    latency_jitter_ms_max: number;
    blend_actors: boolean;
    hft_cancel_rate_min: number;
    hft_cancel_rate_max: number;
    scenario_instances: Record<ScenarioId, number>;
  };
  regimes: {
    mean_reversion_per_s: number;
    intraday_profile: {
      open_boost: number;
      close_boost: number;
      decay_minutes: number;
    };
    volatility: Record<Regime, VolatilityRegimeParams>;
    liquidity: Record<Regime, LiquidityRegimeParams>;
  };
  validation: {
    replay_check: boolean;
    max_regeneration_attempts: number;
  };
}

export interface LaunchOptions {
  fmt: 'parquet' | 'csv';
  out: string;
  gate: boolean;
  defectRatePct: number;
}

export interface ConfigValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  capacity: {
    slots_per_instrument: number;
    instruments: number;
    approx_capacity: number;
    requested_instances: number;
    session_s: number;
    warmup_s: number;
    active_s: number;
    cooldown_s: number;
  };
}

