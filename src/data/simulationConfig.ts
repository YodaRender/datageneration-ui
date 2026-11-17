import {
  ConfigValidationResult,
  InstrumentConfigRow,
  LaunchOptions,
  ScenarioDefinition,
  ScenarioId,
  SimulationConfig,
} from '../types/surveillance';

export const SCENARIO_DEFINITIONS: ScenarioDefinition[] = [
  {
    id: 'S01',
    name: 'Large order, no fill',
    group: 'Large-order patterns',
    role: 'pattern',
    script: 'large_order.py',
    family: 'Large-order patterns',
    category: 'Unfilled oversized resting order',
    desc: 'Places a large order several ticks behind the touch and holds it without a fill.',
    knobs: ['large_depth_multiple', 'difficulty', 'hold_duration_s'],
    fixed: [
      'One order placed several ticks behind the touch; placement distance is fixed in the script.',
    ],
  },
  {
    id: 'S02',
    name: 'Large order, partial fill',
    group: 'Large-order patterns',
    role: 'pattern',
    script: 'large_order.py',
    family: 'Large-order patterns',
    category: 'Partially executed oversized order',
    desc: 'Large order that is allowed to fill part of its size, then continues as a large-order episode.',
    knobs: ['large_depth_multiple', 'difficulty', 'display_duration_s', 'hold_duration_s'],
    fixed: [
      'Fill fraction is fixed at 30–70%. Shared partial_fill_* settings do not control it.',
    ],
  },
  {
    id: 'S03',
    name: 'Large order, full fill',
    group: 'Large-order patterns',
    role: 'pattern',
    script: 'large_order.py',
    family: 'Large-order patterns',
    category: 'Fully executed oversized order',
    desc: 'Large order that attempts a full IOC fill against the book.',
    knobs: ['large_depth_multiple', 'difficulty', 'display_duration_s'],
    fixed: ['The script attempts a full IOC fill.'],
  },
  {
    id: 'S04',
    name: 'Large order, quick cancel',
    group: 'Large-order patterns',
    role: 'pattern',
    script: 'large_order.py',
    family: 'Large-order patterns',
    category: 'Short-lived oversized order',
    desc: 'Large order displayed briefly, then cancelled.',
    knobs: ['large_depth_multiple', 'difficulty', 'display_duration_s'],
    fixed: ['Quick-cancel timing and placement distance are script-defined.'],
  },
  {
    id: 'S05',
    name: 'Layering, gradual cancellation',
    group: 'Layering patterns',
    role: 'pattern',
    script: 'layering.py',
    family: 'Layering patterns',
    category: 'Stacked depth withdrawn gradually',
    desc: 'Builds a same-side ladder and cancels it in stages.',
    knobs: [
      'layer_count',
      'layer_price_step_ticks',
      'layer_volume_decay',
      'difficulty',
      'hold_duration_s',
      'partial_fill',
    ],
    fixed: ['Layer placement intervals and gradual cancel gaps are fixed.'],
  },
  {
    id: 'S06',
    name: 'Persistent layered quoting',
    group: 'Layering patterns',
    role: 'control',
    script: 'layering.py',
    family: 'Benign look-alike controls',
    category: 'Persistent layered quoting control',
    desc: 'Leaves a layered quote in place on purpose. Actor blending is bypassed.',
    knobs: [
      'layer_count',
      'layer_price_step_ticks',
      'layer_volume_decay',
      'difficulty',
      'hold_duration_s',
    ],
    fixed: ['It deliberately does not cancel its layers; actor blending is bypassed.'],
  },
  {
    id: 'S07',
    name: 'Layering, rapid cancellation',
    group: 'Layering patterns',
    role: 'pattern',
    script: 'layering.py',
    family: 'Layering patterns',
    category: 'Stacked depth withdrawn as a batch',
    desc: 'Builds a ladder and cancels it as a rapid batch.',
    knobs: [
      'layer_count',
      'layer_price_step_ticks',
      'layer_volume_decay',
      'difficulty',
      'display_duration_s',
      'partial_fill',
    ],
    fixed: ['Cancellation is performed as a rapid batch.'],
  },
  {
    id: 'S08',
    name: 'Layering with linked opposite-side trade',
    group: 'Spoofing-like sequences',
    role: 'pattern',
    script: 'spoofing_like.py',
    family: 'Spoofing-like sequences',
    category: 'Ladder plus linked opposite-side execution',
    desc: 'Layered orders plus a linked genuine trade on the opposite side.',
    knobs: [
      'layer_count',
      'layer_price_step_ticks',
      'layer_volume_decay',
      'difficulty',
      'resting_time',
      'partial_fill',
    ],
    fixed: ['Trade retries and fallback behavior are fixed in the script.'],
  },
  {
    id: 'S09',
    name: 'Layering without linked trade',
    group: 'Spoofing-like sequences',
    role: 'pattern',
    script: 'spoofing_like.py',
    family: 'Spoofing-like sequences',
    category: 'Ladder with no linked execution',
    desc: 'Same layered construction without a linked opposite-side trade.',
    knobs: [
      'layer_count',
      'layer_price_step_ticks',
      'layer_volume_decay',
      'difficulty',
      'resting_time',
      'partial_fill',
    ],
    fixed: ['The no-linked-trade pattern is script-defined.'],
  },
  {
    id: 'S10',
    name: 'Patient institutional large order',
    group: 'Benign controls',
    role: 'control',
    script: 'large_order.py',
    family: 'Benign look-alike controls',
    category: 'Patient institutional control',
    desc: 'Large-order control with slower, institutional-style replacement.',
    knobs: ['large_depth_multiple', 'difficulty', 'hold_duration_s'],
    fixed: ['Replacement timing and behavior are fixed.'],
  },
  {
    id: 'S11',
    name: 'Market-maker quote updates',
    group: 'Benign controls',
    role: 'control',
    script: 'controls.py',
    family: 'Benign look-alike controls',
    category: 'Market-maker quoting control',
    desc: 'Repeated two-sided quote updates. High cancel activity is expected.',
    knobs: ['blend_actors', 'latency_jitter'],
    fixed: [
      'Update count (6–10), update gaps, and quote behavior are fixed. hft_cancel_rate_* does not control it.',
    ],
  },
  {
    id: 'S12',
    name: 'Legitimate two-sided multi-level quoting',
    group: 'Benign controls',
    role: 'control',
    script: 'controls.py',
    family: 'Benign look-alike controls',
    category: 'Two-sided ladder control',
    desc: 'Three levels per side with refresh behavior. Common layer_count does not change its ladder size.',
    knobs: ['hold_duration_s', 'blend_actors'],
    fixed: ['Three levels per side, refresh behavior, and order sizing are fixed.'],
  },
  {
    id: 'S13',
    name: 'High-volatility burst',
    group: 'Benign controls',
    role: 'control',
    script: 'controls.py',
    family: 'Benign look-alike controls',
    category: 'Volatility-shock control',
    desc: 'Burst of aggressive flow on a high-volatility instrument.',
    knobs: ['large_depth_multiple', 'difficulty'],
    extra: 'Instrument regime is used; the type is planned onto the live book like the others.',
    fixed: ['Shock count, spacing, and shock-order size range are fixed.'],
  },
  {
    id: 'S14',
    name: 'Small order on an illiquid book',
    group: 'Benign controls',
    role: 'control',
    script: 'large_order.py',
    family: 'Benign look-alike controls',
    category: 'Illiquid-book size control',
    desc: 'Preferentially planned on low-liquidity instruments. Relative size comes from book depth, not the large-order multiple.',
    knobs: ['hold_duration_s'],
    fixed: ['Relative size is fixed from book depth; it does not use the shared large-order multiple.'],
  },
  {
    id: 'S15',
    name: 'Coincidental-trade control',
    group: 'Benign controls',
    role: 'control',
    script: 'spoofing_like.py',
    family: 'Benign look-alike controls',
    category: 'Unrelated trade near layered activity',
    desc: 'Layered activity with an unrelated trade nearby. Actor blending is bypassed.',
    knobs: [
      'layer_count',
      'layer_price_step_ticks',
      'layer_volume_decay',
      'difficulty',
      'resting_time',
      'latency_jitter',
    ],
    fixed: ['Timing of the unrelated trade is script-defined; actor blending is bypassed.'],
  },
  {
    id: 'S16',
    name: 'Feed-anomaly control',
    group: 'Benign controls',
    role: 'control',
    script: 'controls.py',
    family: 'Benign look-alike controls',
    category: 'GAP / DUPLICATE / INCONSISTENT',
    desc: 'Cycles GAP, DUPLICATE, and INCONSISTENT by instance order. There is no YAML selector for the kind.',
    knobs: ['blend_actors', 'latency_jitter'],
    fixed: ['Anomaly kind cycles through GAP, DUPLICATE, and INCONSISTENT by instance order.'],
  },
];

export const DEFAULT_INSTRUMENTS: InstrumentConfigRow[] = [
  {
    instrument_id: 'INST-NSE-RELIANCE',
    symbol: 'RELIANCE',
    exchange: 'NSE',
    currency: 'INR',
    tick_size: 0.05,
    lot_size: 1,
    reference_price: 1284.5,
    volatility_regime: 'MEDIUM',
    liquidity_regime: 'HIGH',
  },
  {
    instrument_id: 'INST-NSE-INFY',
    symbol: 'INFY',
    exchange: 'NSE',
    currency: 'INR',
    tick_size: 0.05,
    lot_size: 1,
    reference_price: 1862.2,
    volatility_regime: 'LOW',
    liquidity_regime: 'HIGH',
  },
  {
    instrument_id: 'INST-NSE-HDFCBANK',
    symbol: 'HDFCBANK',
    exchange: 'NSE',
    currency: 'INR',
    tick_size: 0.05,
    lot_size: 1,
    reference_price: 1742.0,
    volatility_regime: 'MEDIUM',
    liquidity_regime: 'MEDIUM',
  },
  {
    instrument_id: 'INST-NSE-TCS',
    symbol: 'TCS',
    exchange: 'NSE',
    currency: 'INR',
    tick_size: 0.05,
    lot_size: 1,
    reference_price: 4118.4,
    volatility_regime: 'HIGH',
    liquidity_regime: 'MEDIUM',
  },
  {
    instrument_id: 'INST-NSE-MIDCAPX',
    symbol: 'MIDCAPX',
    exchange: 'NSE',
    currency: 'INR',
    tick_size: 0.05,
    lot_size: 5,
    reference_price: 642.85,
    volatility_regime: 'HIGH',
    liquidity_regime: 'LOW',
  },
];

export const YAML_DEFAULT_INSTANCES: Record<ScenarioId, number> = {
  S01: 25,
  S02: 25,
  S03: 25,
  S04: 25,
  S05: 25,
  S06: 25,
  S07: 25,
  S08: 25,
  S09: 25,
  S10: 25,
  S11: 25,
  S12: 25,
  S13: 25,
  S14: 25,
  S15: 25,
  S16: 25,
};

export const QUICK_INSTANCES: Record<ScenarioId, number> = {
  S01: 1,
  S02: 1,
  S03: 1,
  S04: 1,
  S05: 1,
  S06: 1,
  S07: 1,
  S08: 1,
  S09: 1,
  S10: 1,
  S11: 1,
  S12: 1,
  S13: 1,
  S14: 1,
  S15: 1,
  S16: 1,
};

export const DEMO_INSTANCES: Record<ScenarioId, number> = {
  S01: 2,
  S02: 2,
  S03: 2,
  S04: 2,
  S05: 2,
  S06: 2,
  S07: 2,
  S08: 2,
  S09: 2,
  S10: 2,
  S11: 2,
  S12: 2,
  S13: 2,
  S14: 2,
  S15: 2,
  S16: 2,
};

export const DEFAULT_LAUNCH_OPTIONS: LaunchOptions = {
  fmt: 'parquet',
  out: 'out/ui-runs',
  persist: false,
  gate: true,
  defectRatePct: 0,
};

export function createDefaultSimulationConfig(): SimulationConfig {
  return {
    session: {
      trading_date: '2026-11-17',
      timezone: 'Asia/Kolkata',
      run_duration_s: 1500,
    },
    market: {
      instrument_count: 2,
      volatility_regime: 'MEDIUM',
      liquidity_regime: 'HIGH',
    },
    reproducibility: {
      random_seed: 4201,
    },
    instruments: DEFAULT_INSTRUMENTS.map((row) => ({ ...row })),
    event_rates: {
      background_events_per_second: 8.5,
      cancel_rate: 0.42,
      amend_rate: 0.14,
      marketable_share: 0.24,
      market_order_share: 0.12,
      marketable_ioc_share: 0.18,
      participant_count: 16,
      participant_zipf_exponent: 1.15,
      amend_qty_decrease_share: 0.35,
      amend_price_change_share: 0.65,
    },
    book: {
      snapshot_levels_n: 5,
      snapshot_mode: 'BOTH',
      snapshot_interval_ms: 1000,
      self_match_prevention: 'prevent-cancel-resting',
      full_invariant_check_interval: 500,
    },
    timing: {
      internal_precision: 'MICROSECOND',
      export_precision: 'MILLISECOND',
    },
    features: {
      depth_n: 5,
      depth_band_pct: 0.5,
      group_gap_ms: 1500,
      group_max_span_ms: 25000,
      trailing_window_ms: 15000,
      background_order_sample_rate: 0.04,
      depth_convention: 'TOPN',
    },
    scenario: {
      scenario_slot_s: 40,
      warmup_frac: 0.08,
      cooldown_frac: 0.07,
      difficulty: 'mixed',
      large_depth_multiple_min: 4.5,
      large_depth_multiple_max: 12.0,
      layer_count: 5,
      layer_price_step_ticks: 1,
      layer_volume_decay: 0.82,
      display_duration_s_min: 0.8,
      display_duration_s_max: 3.5,
      hold_duration_s_min: 4.0,
      hold_duration_s_max: 16.0,
      resting_time_distribution: 'lognormal',
      resting_time_lognormal_mu: 0.75,
      resting_time_lognormal_sigma: 0.65,
      resting_time_min_s: 0.4,
      resting_time_max_s: 12.0,
      partial_fill_enabled: true,
      partial_fill_prob: 0.35,
      partial_fill_min_ratio: 0.15,
      partial_fill_max_ratio: 0.55,
      latency_jitter_enabled: true,
      latency_jitter_ms_min: 4,
      latency_jitter_ms_max: 45,
      blend_actors: true,
      hft_cancel_rate_min: 0.55,
      hft_cancel_rate_max: 0.85,
      scenario_instances: { ...DEMO_INSTANCES },
    },
    regimes: {
      mean_reversion_per_s: 0.0025,
      intraday_profile: {
        open_boost: 2.2,
        close_boost: 1.8,
        decay_minutes: 25,
      },
      volatility: {
        LOW: {
          sigma_bps_per_sqrt_s: 0.35,
          vol_of_vol: 0.15,
          vol_persistence: 0.965,
          activity_exponent: 0.65,
        },
        MEDIUM: {
          sigma_bps_per_sqrt_s: 0.85,
          vol_of_vol: 0.28,
          vol_persistence: 0.955,
          activity_exponent: 0.9,
        },
        HIGH: {
          sigma_bps_per_sqrt_s: 1.75,
          vol_of_vol: 0.48,
          vol_persistence: 0.94,
          activity_exponent: 1.25,
        },
      },
      liquidity: {
        LOW: {
          depth_scale: 0.45,
          size_median: 60,
          size_sigma: 0.85,
          size_max: 2400,
          half_spread_ticks: 3.0,
          offset_scale_ticks: 4.5,
          seed_levels: 5,
          seed_orders_per_level: 2,
          rate_multiplier: 0.5,
        },
        MEDIUM: {
          depth_scale: 1.0,
          size_median: 140,
          size_sigma: 0.75,
          size_max: 6000,
          half_spread_ticks: 1.0,
          offset_scale_ticks: 2.5,
          seed_levels: 8,
          seed_orders_per_level: 3,
          rate_multiplier: 1.0,
        },
        HIGH: {
          depth_scale: 1.9,
          size_median: 240,
          size_sigma: 0.65,
          size_max: 15000,
          half_spread_ticks: 0.5,
          offset_scale_ticks: 1.8,
          seed_levels: 12,
          seed_orders_per_level: 4,
          rate_multiplier: 1.7,
        },
      },
    },
    validation: {
      replay_check: true,
      max_regeneration_attempts: 2,
    },
  };
}

export function cloneConfig(cfg: SimulationConfig): SimulationConfig {
  return JSON.parse(JSON.stringify(cfg)) as SimulationConfig;
}

export function computeConfigHash(cfg: SimulationConfig, launch?: LaunchOptions): string {
  const payload = JSON.stringify({
    session: cfg.session,
    market: cfg.market,
    reproducibility: cfg.reproducibility,
    instruments: cfg.instruments.slice(0, cfg.market.instrument_count),
    event_rates: cfg.event_rates,
    book: cfg.book,
    timing: cfg.timing,
    features: cfg.features,
    scenario: cfg.scenario,
    regimes: cfg.regimes,
    validation: cfg.validation,
    defectRatePct: launch?.defectRatePct ?? 0,
  });
  let h1 = 0xdeadbeef ^ payload.length;
  let h2 = 0x41c6ce57 ^ payload.length;
  for (let i = 0; i < payload.length; i++) {
    const ch = payload.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex = (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
  return `sha256:${hex.slice(0, 12)}`;
}

export function computeCapacity(cfg: SimulationConfig): ConfigValidationResult['capacity'] {
  const session_s = cfg.session.run_duration_s || 1500;
  const warm = cfg.scenario.warmup_frac;
  const cool = cfg.scenario.cooldown_frac;
  const activeFrac = Math.max(0, 1 - warm - cool);
  const warmup_s = Math.round(warm * session_s);
  const cooldown_s = Math.round(cool * session_s);
  const active_s = Math.max(0, session_s - warmup_s - cooldown_s);
  const instruments = Math.max(1, cfg.market.instrument_count);
  const slot_s = Math.max(1, cfg.scenario.scenario_slot_s);
  const slots_per_instrument = Math.floor((activeFrac * session_s) / slot_s);
  const approx_capacity = slots_per_instrument * instruments;
  const requested_instances = Object.values(cfg.scenario.scenario_instances).reduce(
    (s, n) => s + (Number(n) || 0),
    0
  );
  return {
    slots_per_instrument,
    instruments,
    approx_capacity,
    requested_instances,
    session_s,
    warmup_s,
    active_s,
    cooldown_s,
  };
}

export function validateSimulationConfig(
  cfg: SimulationConfig,
  launch: LaunchOptions
): ConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const cap = computeCapacity(cfg);

  if (cfg.event_rates.cancel_rate + cfg.event_rates.amend_rate >= 1) {
    errors.push(
      `cancel_rate (${cfg.event_rates.cancel_rate.toFixed(2)}) + amend_rate (${cfg.event_rates.amend_rate.toFixed(
        2
      )}) must stay strictly below 1.00.`
    );
  }

  if (cfg.scenario.warmup_frac + cfg.scenario.cooldown_frac >= 0.95) {
    errors.push('warmup_frac + cooldown_frac leaves insufficient active session time (<5%).');
  }

  if (cfg.market.instrument_count < 1 || cfg.market.instrument_count > cfg.instruments.length) {
    errors.push(
      `market.instrument_count (${cfg.market.instrument_count}) must be between 1 and ${cfg.instruments.length}.`
    );
  }

  const activeInstruments = cfg.instruments.slice(0, cfg.market.instrument_count);
  for (const inst of activeInstruments) {
    if (!(Number(inst.tick_size) > 0)) {
      errors.push(`${inst.symbol || inst.instrument_id}: tick_size must be positive.`);
    }
    if (!(Number(inst.lot_size) >= 1)) {
      errors.push(`${inst.symbol || inst.instrument_id}: lot_size must be >= 1.`);
    }
    if (!(Number(inst.reference_price) > 0)) {
      errors.push(`${inst.symbol || inst.instrument_id}: reference_price must be positive.`);
    }
  }

  if (cfg.scenario.large_depth_multiple_min > cfg.scenario.large_depth_multiple_max) {
    errors.push('large_depth_multiple_min cannot exceed large_depth_multiple_max.');
  }
  if (cfg.scenario.display_duration_s_min > cfg.scenario.display_duration_s_max) {
    errors.push('display_duration_s_min cannot exceed display_duration_s_max.');
  }
  if (cfg.scenario.hold_duration_s_min > cfg.scenario.hold_duration_s_max) {
    errors.push('hold_duration_s_min cannot exceed hold_duration_s_max.');
  }
  if (cfg.scenario.resting_time_min_s > cfg.scenario.resting_time_max_s) {
    errors.push('resting_time_min_s cannot exceed resting_time_max_s.');
  }
  if (cfg.scenario.partial_fill_min_ratio > cfg.scenario.partial_fill_max_ratio) {
    errors.push('partial_fill_min_ratio cannot exceed partial_fill_max_ratio.');
  }
  if (cfg.scenario.latency_jitter_ms_min > cfg.scenario.latency_jitter_ms_max) {
    errors.push('latency_jitter_ms_min cannot exceed latency_jitter_ms_max.');
  }

  if (cap.requested_instances === 0) {
    warnings.push('All S01–S16 scenario_instances are 0 — run will contain baseline flow only.');
  } else if (cap.requested_instances > cap.approx_capacity) {
    warnings.push(
      `Requested ${cap.requested_instances} instances exceed ~${cap.approx_capacity} non-overlapping slots (${cap.slots_per_instrument}/inst × ${cap.instruments}). Generator will pack slots tightly or trim overflow.`
    );
  }

  if ((cfg.scenario.scenario_instances.S16 ?? 0) > 0 && launch.gate) {
    warnings.push(
      'S16 (Feed-anomaly control) injects GAP/DUPLICATE/INCONSISTENT markers; strict validation gate checks event-stream flags.'
    );
  }

  if (launch.defectRatePct > 0 && launch.gate) {
    warnings.push(
      `Injecting ${launch.defectRatePct.toFixed(1)}% synthetic DQ defects with Validation gate ON will mark run status FAILED unless gate is disabled.`
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    capacity: cap,
  };
}
