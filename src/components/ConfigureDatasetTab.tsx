import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  Play,
  RotateCcw,
  ShieldAlert,
  Shuffle,
} from 'lucide-react';
import {
  ConfigValidationResult,
  LaunchOptions,
  Regime,
  ScenarioDefinition,
  ScenarioId,
  SharedKnobKey,
  SimulationConfig,
  SyntheticDataset,
} from '../types/surveillance';
import {
  cloneConfig,
  computeCapacity,
  computeConfigHash,
  createDefaultSimulationConfig,
  DEFAULT_LAUNCH_OPTIONS,
  DEMO_INSTANCES,
  estimateInstrumentEventRates,
  FULL_MARKET_DAY_SECONDS,
  QUICK_INSTANCES,
  SCENARIO_DEFINITIONS,
  validateSimulationConfig,
  YAML_DEFAULT_INSTANCES,
} from '../data/simulationConfig';
import { buildConfiguredSyntheticRun } from '../data/syntheticRunGenerator';
import {
  ControlCard,
  RangeKnob,
  SelectControl,
  TextControl,
  ToggleControl,
} from './ConfigControls';

interface ConfigureDatasetTabProps {
  onRunGenerated: (dataset: SyntheticDataset) => void;
  onNavigateTab: (tab: 'market' | 'dq' | 'det') => void;
}

type ModeView = 'run' | 'launch';
type RunCategory = 'market' | 'episodes' | 'measurement';
type MarketSubTab = 'session' | 'regimes' | 'rates';
type EpisodesSubTab = 'scenario' | 'counts' | 'scenarios';
type MeasurementSubTab = 'book';

const RUN_CATEGORIES: Array<{ key: RunCategory; label: string }> = [
  { key: 'market', label: 'Market' },
  { key: 'episodes', label: 'Episodes' },
  { key: 'measurement', label: 'Measurement' },
];

const MARKET_SUB_TABS: Array<{ key: MarketSubTab; label: string }> = [
  { key: 'session', label: 'Session & market' },
  { key: 'regimes', label: 'Regimes' },
  { key: 'rates', label: 'Baseline activity' },
];

const EPISODES_SUB_TABS: Array<{ key: EpisodesSubTab; label: string }> = [
  { key: 'scenario', label: 'Shared scenario' },
  { key: 'counts', label: 'Per-type instance counts' },
  { key: 'scenarios', label: 'Scenario library (16)' },
];

const MEASUREMENT_SUB_TABS: Array<{ key: MeasurementSubTab; label: string }> = [
  { key: 'book', label: 'Book & features' },
];

const SCENARIO_GROUPS: ScenarioDefinition['group'][] = [
  'Large-order patterns',
  'Layering patterns',
  'Spoofing-like sequences',
  'Benign controls',
];

export const ConfigureDatasetTab: React.FC<ConfigureDatasetTabProps> = ({
  onRunGenerated,
  onNavigateTab,
}) => {
  const [config, setConfig] = useState<SimulationConfig>(() => createDefaultSimulationConfig());
  const [launch, setLaunch] = useState<LaunchOptions>(() => ({ ...DEFAULT_LAUNCH_OPTIONS }));
  const [mode, setMode] = useState<ModeView>('run');
  const [runCategory, setRunCategory] = useState<RunCategory>('market');
  const [marketSubTab, setMarketSubTab] = useState<MarketSubTab>('session');
  const [episodesSubTab, setEpisodesSubTab] = useState<EpisodesSubTab>('scenario');
  const [measurementSubTab, setMeasurementSubTab] = useState<MeasurementSubTab>('book');
  const [activeScenarioId, setActiveScenarioId] = useState<ScenarioId | null>(null);
  const [validationResult, setValidationResult] = useState<ConfigValidationResult | null>(null);
  const [lastGenerated, setLastGenerated] = useState<SyntheticDataset | null>(null);
  const [showAdvancedResting, setShowAdvancedResting] = useState<boolean>(false);
  const [statusLog, setStatusLog] = useState<string>(
    'Ready. Configure simulation parameters or choose a preset to generate a synthetic dataset.'
  );

  const capacity = useMemo(() => computeCapacity(config), [config]);
  const configHash = useMemo(() => computeConfigHash(config, launch), [config, launch]);
  const rateEstimates = useMemo(() => estimateInstrumentEventRates(config), [config]);

  const updateConfig = (mutator: (draft: SimulationConfig) => void) => {
    setConfig((prev) => {
      const next = cloneConfig(prev);
      mutator(next);
      return next;
    });
  };

  const applyPreset = (kind: 'quick' | 'demo' | 'yaml' | 'reset') => {
    if (kind === 'reset') {
      setConfig(createDefaultSimulationConfig());
      setLaunch({ ...DEFAULT_LAUNCH_OPTIONS });
      setValidationResult(null);
      setStatusLog('Configuration reset to default console baseline.');
      return;
    }
    updateConfig((draft) => {
      draft.session.run_duration_s = FULL_MARKET_DAY_SECONDS;
      if (kind === 'quick') {
        draft.scenario.scenario_instances = { ...QUICK_INSTANCES };
      } else if (kind === 'demo') {
        draft.scenario.scenario_instances = { ...DEMO_INSTANCES };
      } else if (kind === 'yaml') {
        draft.scenario.scenario_instances = { ...YAML_DEFAULT_INSTANCES };
      }
    });
    setValidationResult(null);
    setStatusLog(
      kind === 'quick'
        ? 'Applied Quick preset (09:15–15:15 · 1× per scenario).'
        : kind === 'demo'
          ? 'Applied Makefile demo preset (09:15–15:15 · 2× per scenario).'
          : 'Applied YAML default counts (09:15–15:15 · 25× per scenario).'
    );
  };

  const handleValidate = (): ConfigValidationResult => {
    const res = validateSimulationConfig(config, launch);
    setValidationResult(res);
    setStatusLog(
      res.ok
        ? `Validation passed (${res.capacity.requested_instances} instances across ~${res.capacity.approx_capacity} slots).`
        : `Validation failed: ${res.errors[0]}`
    );
    return res;
  };

  const handleGenerate = (focusScenario?: ScenarioId | null) => {
    const res = validateSimulationConfig(config, launch);
    setValidationResult(res);
    if (!res.ok) {
      setStatusLog(`Generation blocked: ${res.errors[0]}`);
      return;
    }
    const dataset = buildConfiguredSyntheticRun(config, launch, focusScenario ?? null);
    setLastGenerated(dataset);
    onRunGenerated(dataset);
    setStatusLog(
      `Generated ${dataset.run_metadata.run_id} (${dataset.run_metadata.status}) · ${dataset.model_input.order_events.length.toLocaleString()} events · ${dataset.evaluator_bundle.scenario_manifest.length} scenarios.`
    );
  };

  const handleDownloadJson = (payload: unknown, filename: string) => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const renderSharedKnob = (key: SharedKnobKey) => {
    switch (key) {
      case 'large_depth_multiple':
        return (
          <RangeKnob
            key={key}
            label="Large-order depth multiple"
            keyPath="scenario.large_depth_multiple_min / max"
            min={1}
            max={20}
            step={0.5}
            value={config.scenario.large_depth_multiple_min}
            rangeMaxValue={config.scenario.large_depth_multiple_max}
            onChange={(v) => updateConfig((d) => { d.scenario.large_depth_multiple_min = v; })}
            onChangeRangeMax={(v) => updateConfig((d) => { d.scenario.large_depth_multiple_max = v; })}
            format={(v) => `${v.toFixed(1)}×`}
            hint="Shared helper. Not used by S14."
          />
        );
      case 'layer_count':
        return (
          <RangeKnob
            key={key}
            label="Layer count"
            keyPath="scenario.layer_count"
            min={2}
            max={8}
            step={1}
            value={config.scenario.layer_count}
            onChange={(v) => updateConfig((d) => { d.scenario.layer_count = v; })}
            hint="S12 ignores this and stays at three levels per side."
          />
        );
      case 'layer_price_step_ticks':
        return (
          <RangeKnob
            key={key}
            label="Layer price step"
            keyPath="scenario.layer_price_step_ticks"
            min={1}
            max={5}
            step={1}
            value={config.scenario.layer_price_step_ticks}
            onChange={(v) => updateConfig((d) => { d.scenario.layer_price_step_ticks = v; })}
            format={(v) => `${v} tick`}
          />
        );
      case 'layer_volume_decay':
        return (
          <RangeKnob
            key={key}
            label="Layer volume decay"
            keyPath="scenario.layer_volume_decay"
            min={0.3}
            max={1}
            step={0.01}
            value={config.scenario.layer_volume_decay}
            onChange={(v) => updateConfig((d) => { d.scenario.layer_volume_decay = v; })}
          />
        );
      case 'difficulty':
        return (
          <SelectControl
            key={key}
            label="Difficulty"
            keyPath="scenario.difficulty"
            value={config.scenario.difficulty}
            options={['easy', 'medium', 'hard', 'mixed']}
            onChange={(v) =>
              updateConfig((d) => {
                d.scenario.difficulty = v as SimulationConfig['scenario']['difficulty'];
              })
            }
          />
        );
      case 'display_duration_s':
        return (
          <RangeKnob
            key={key}
            label="Display duration"
            keyPath="scenario.display_duration_s_min / max"
            min={0.2}
            max={20}
            step={0.1}
            value={config.scenario.display_duration_s_min}
            rangeMaxValue={config.scenario.display_duration_s_max}
            onChange={(v) => updateConfig((d) => { d.scenario.display_duration_s_min = v; })}
            onChangeRangeMax={(v) => updateConfig((d) => { d.scenario.display_duration_s_max = v; })}
            format={(v) => `${v.toFixed(1)} s`}
          />
        );
      case 'hold_duration_s':
        return (
          <RangeKnob
            key={key}
            label="Hold duration"
            keyPath="scenario.hold_duration_s_min / max"
            min={1}
            max={40}
            step={0.5}
            value={config.scenario.hold_duration_s_min}
            rangeMaxValue={config.scenario.hold_duration_s_max}
            onChange={(v) => updateConfig((d) => { d.scenario.hold_duration_s_min = v; })}
            onChangeRangeMax={(v) => updateConfig((d) => { d.scenario.hold_duration_s_max = v; })}
            format={(v) => `${v.toFixed(1)} s`}
          />
        );
      case 'partial_fill':
        return (
          <RangeKnob
            key={key}
            label="Partial-fill probability"
            keyPath="scenario.partial_fill_prob"
            min={0}
            max={1}
            step={0.01}
            value={config.scenario.partial_fill_prob}
            onChange={(v) => updateConfig((d) => { d.scenario.partial_fill_prob = v; })}
            format={(v) => `${Math.round(v * 100)}%`}
            hint="Requires partial_fill_enabled. Does not drive S02."
          />
        );
      case 'resting_time': {
        const typicalSec = Number(
          Math.max(0.2, Math.min(15, Math.exp(config.scenario.resting_time_lognormal_mu))).toFixed(1)
        );
        const varLevel: 'low' | 'medium' | 'high' =
          config.scenario.resting_time_lognormal_sigma <= 0.45
            ? 'low'
            : config.scenario.resting_time_lognormal_sigma <= 0.85
              ? 'medium'
              : 'high';
        return (
          <div key={key} className="space-y-3">
            <RangeKnob
              label="Typical resting time"
              keyPath="scenario.resting_time_lognormal_mu"
              min={0.2}
              max={15}
              step={0.1}
              value={typicalSec}
              onChange={(v) =>
                updateConfig((d) => {
                  d.scenario.resting_time_lognormal_mu = Number(
                    Math.log(Math.max(0.1, v)).toFixed(4)
                  );
                })
              }
              format={(v) => `${v.toFixed(1)} s`}
              hint="Median resting duration before cancel/fill."
            />
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[var(--ink)]">Variability</span>
                <span className="text-[11px] font-mono-tabular text-[var(--mut)]">
                  σ = {config.scenario.resting_time_lognormal_sigma.toFixed(2)}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {(['low', 'medium', 'high'] as const).map((lvl) => {
                  const active = varLevel === lvl;
                  const targetSigma = lvl === 'low' ? 0.3 : lvl === 'medium' ? 0.65 : 1.1;
                  return (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() =>
                        updateConfig((d) => {
                          d.scenario.resting_time_lognormal_sigma = targetSigma;
                        })
                      }
                      aria-pressed={active}
                      className={`px-2 py-1 text-xs font-semibold rounded-lg border capitalize cursor-pointer ${
                        active
                          ? 'bg-[var(--ink)] text-[var(--bg)] border-[var(--ink)]'
                          : 'bg-[var(--sf)] text-[var(--ink)] border-[var(--ln)] hover:bg-[var(--sf-alt)]'
                      }`}
                    >
                      {lvl}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="pt-1 border-t border-[var(--ln)]/60">
              <button
                type="button"
                onClick={() => setShowAdvancedResting((v) => !v)}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--mut)] hover:text-[var(--ink)] cursor-pointer"
              >
                {showAdvancedResting ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
                <span>Advanced resting-time parameters</span>
              </button>
              {showAdvancedResting && (
                <div className="mt-2.5 space-y-2.5 pt-2 border-t border-[var(--ln)]/50">
                  <SelectControl
                    label="Resting-time distribution"
                    keyPath="scenario.resting_time_distribution"
                    value={config.scenario.resting_time_distribution}
                    options={['lognormal', 'uniform']}
                    onChange={(v) =>
                      updateConfig((d) => {
                        d.scenario.resting_time_distribution = v as 'lognormal' | 'uniform';
                      })
                    }
                  />
                  <RangeKnob
                    label="Lognormal μ / σ"
                    keyPath="scenario.resting_time_lognormal_mu / sigma"
                    min={0.05}
                    max={3}
                    step={0.05}
                    value={config.scenario.resting_time_lognormal_mu}
                    rangeMaxValue={config.scenario.resting_time_lognormal_sigma}
                    onChange={(v) =>
                      updateConfig((d) => {
                        d.scenario.resting_time_lognormal_mu = v;
                      })
                    }
                    onChangeRangeMax={(v) =>
                      updateConfig((d) => {
                        d.scenario.resting_time_lognormal_sigma = v;
                      })
                    }
                  />
                  <RangeKnob
                    label="Resting-time bounds"
                    keyPath="scenario.resting_time_min_s / max_s"
                    min={0.05}
                    max={30}
                    step={0.05}
                    value={config.scenario.resting_time_min_s}
                    rangeMaxValue={config.scenario.resting_time_max_s}
                    onChange={(v) =>
                      updateConfig((d) => {
                        d.scenario.resting_time_min_s = v;
                      })
                    }
                    onChangeRangeMax={(v) =>
                      updateConfig((d) => {
                        d.scenario.resting_time_max_s = v;
                      })
                    }
                    format={(v) => `${v.toFixed(2)} s`}
                  />
                </div>
              )}
            </div>
          </div>
        );
      }
      case 'latency_jitter':
        return (
          <RangeKnob
            key={key}
            label="Latency jitter"
            keyPath="scenario.latency_jitter_ms_min / max"
            min={0}
            max={250}
            step={1}
            value={config.scenario.latency_jitter_ms_min}
            rangeMaxValue={config.scenario.latency_jitter_ms_max}
            onChange={(v) => updateConfig((d) => { d.scenario.latency_jitter_ms_min = v; })}
            onChangeRangeMax={(v) => updateConfig((d) => { d.scenario.latency_jitter_ms_max = v; })}
            format={(v) => `${v} ms`}
          />
        );
      case 'blend_actors':
        return (
          <ToggleControl
            key={key}
            label="Blend actors"
            keyPath="scenario.blend_actors"
            checked={config.scenario.blend_actors}
            onChange={(v) => updateConfig((d) => { d.scenario.blend_actors = v; })}
            hint="S06 and S15 bypass this."
          />
        );
    }
  };

  const activeScenario = activeScenarioId
    ? SCENARIO_DEFINITIONS.find((s) => s.id === activeScenarioId) ?? null
    : null;

  return (
    <div className="space-y-5">
      {/* Header & Summary Strip */}
      <div className="flex flex-wrap items-start justify-between gap-4 pb-3 border-b border-[var(--ln)]">
        <div className="space-y-1 max-w-3xl">
          <h2 className="text-base font-bold text-[var(--ink)]">
            Configure synthetic market abuse dataset
          </h2>
          <p className="text-xs text-[var(--mut)] leading-relaxed">
            Adjust session parameters, market microstructure regimes, shared scenario parameters,
            and S01–S16 instance counts. Generating builds a fresh label-isolated dataset you can
            inspect immediately in Market view, Data quality, and Surveillance features.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-mono-tabular">
          <div>
            <span className="text-[var(--mut)]">Seed: </span>
            <span className="font-semibold text-[var(--ink)]">
              {config.reproducibility.random_seed}
            </span>
          </div>
          <div>
            <span className="text-[var(--mut)]">Session: </span>
            <span className="font-semibold text-[var(--ink)]">
              09:15–15:15 (6h · {FULL_MARKET_DAY_SECONDS.toLocaleString()}s)
            </span>
          </div>
          <div>
            <span className="text-[var(--mut)]">Instances: </span>
            <span className="font-semibold text-[var(--ink)]">
              {capacity.requested_instances} across 16 types
            </span>
          </div>
          <div>
            <span className="text-[var(--mut)]">Difficulty: </span>
            <span className="font-semibold text-[var(--ink)]">{config.scenario.difficulty}</span>
          </div>
          <div>
            <span className="text-[var(--mut)]">Hash: </span>
            <span className="font-semibold text-[var(--sell)]">{configHash}</span>
          </div>
        </div>
      </div>

      {/* Mode Switcher + Quick Presets */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Configurator mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'run'}
            onClick={() => setMode('run')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap cursor-pointer ${
              mode === 'run'
                ? 'bg-[var(--ink)] text-[var(--bg)] border-[var(--ink)]'
                : 'bg-[var(--bg)] text-[var(--mut)] border-[var(--ln)] hover:text-[var(--ink)]'
            }`}
          >
            Run settings
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'launch'}
            onClick={() => setMode('launch')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap cursor-pointer ${
              mode === 'launch'
                ? 'bg-[var(--ink)] text-[var(--bg)] border-[var(--ink)]'
                : 'bg-[var(--bg)] text-[var(--mut)] border-[var(--ln)] hover:text-[var(--ink)]'
            }`}
          >
            Launch &amp; presets
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-medium text-[var(--mut)] mr-1">Presets:</span>
          <button
            type="button"
            onClick={() => applyPreset('quick')}
            className="px-2.5 py-1 text-xs font-medium rounded-lg border border-[var(--ln)] bg-[var(--bg)] text-[var(--ink)] hover:bg-[var(--sf-alt)] whitespace-nowrap cursor-pointer"
          >
            Quick (1×)
          </button>
          <button
            type="button"
            onClick={() => applyPreset('demo')}
            className="px-2.5 py-1 text-xs font-medium rounded-lg border border-[var(--ln)] bg-[var(--bg)] text-[var(--ink)] hover:bg-[var(--sf-alt)] whitespace-nowrap cursor-pointer"
          >
            Makefile demo (2×)
          </button>
          <button
            type="button"
            onClick={() => applyPreset('yaml')}
            className="px-2.5 py-1 text-xs font-medium rounded-lg border border-[var(--ln)] bg-[var(--bg)] text-[var(--ink)] hover:bg-[var(--sf-alt)] whitespace-nowrap cursor-pointer"
          >
            YAML defaults (25×)
          </button>
          <button
            type="button"
            onClick={() =>
              updateConfig((d) => {
                d.reproducibility.random_seed = 1000 + Math.floor(Math.random() * 8999);
              })
            }
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border border-[var(--ln)] bg-[var(--bg)] text-[var(--ink)] hover:bg-[var(--sf-alt)] whitespace-nowrap cursor-pointer"
            title="Pick a fresh random seed"
          >
            <Shuffle className="w-3 h-3" />
            Random seed
          </button>
        </div>
      </div>

      {/* MODE 1: RUN SETTINGS */}
      {mode === 'run' && (
        <div className="space-y-4">
          {/* Category sub-tabs: Market, Episodes, Measurement */}
          <div
            className="flex flex-wrap gap-1.5 border-b border-[var(--ln)] pb-3"
            role="tablist"
            aria-label="Run settings categories"
          >
            {RUN_CATEGORIES.map((cat) => {
              const selected = runCategory === cat.key;
              return (
                <button
                  key={cat.key}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setRunCategory(cat.key)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap cursor-pointer ${
                    selected
                      ? 'bg-[var(--sf-alt)] text-[var(--ink)] border-[var(--ink)]'
                      : 'bg-transparent text-[var(--mut)] border-[var(--ln)] hover:text-[var(--ink)]'
                  }`}
                >
                  {cat.label}
                </button>
              );
            })}
          </div>

          {/* Child sub-tabs under active category */}
          {runCategory === 'market' && (
            <div
              className="flex flex-wrap gap-1.5 border-b border-[var(--ln)]/70 pb-3"
              role="tablist"
              aria-label="Market configuration tabs"
            >
              {MARKET_SUB_TABS.map((t) => {
                const selected = marketSubTab === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setMarketSubTab(t.key)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap cursor-pointer ${
                      selected
                        ? 'bg-[var(--bg)] text-[var(--ink)] border-[var(--sell)]'
                        : 'bg-transparent text-[var(--mut)] border-[var(--ln)] hover:text-[var(--ink)]'
                    }`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          )}

          {runCategory === 'episodes' && (
            <div
              className="flex flex-wrap gap-1.5 border-b border-[var(--ln)]/70 pb-3"
              role="tablist"
              aria-label="Episodes configuration tabs"
            >
              {EPISODES_SUB_TABS.map((t) => {
                const selected = episodesSubTab === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => {
                      setEpisodesSubTab(t.key);
                      if (t.key === 'scenarios') setActiveScenarioId(null);
                    }}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap cursor-pointer ${
                      selected
                        ? 'bg-[var(--bg)] text-[var(--ink)] border-[var(--sell)]'
                        : 'bg-transparent text-[var(--mut)] border-[var(--ln)] hover:text-[var(--ink)]'
                    }`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          )}

          {runCategory === 'measurement' && (
            <div
              className="flex flex-wrap gap-1.5 border-b border-[var(--ln)]/70 pb-3"
              role="tablist"
              aria-label="Measurement configuration tabs"
            >
              {MEASUREMENT_SUB_TABS.map((t) => {
                const selected = measurementSubTab === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setMeasurementSubTab(t.key)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap cursor-pointer ${
                      selected
                        ? 'bg-[var(--bg)] text-[var(--ink)] border-[var(--sell)]'
                        : 'bg-transparent text-[var(--mut)] border-[var(--ln)] hover:text-[var(--ink)]'
                    }`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          )}

          {/* 1. Market -> Session & Market */}
          {runCategory === 'market' && marketSubTab === 'session' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <ControlCard
                  title="Session"
                  subtitle="Trading date, timezone, and full market-day window."
                >
                  <TextControl
                    label="Trading date"
                    keyPath="session.trading_date"
                    type="date"
                    value={config.session.trading_date}
                    onChange={(v) => updateConfig((d) => { d.session.trading_date = v; })}
                  />
                  <TextControl
                    label="Timezone"
                    keyPath="session.timezone"
                    value={config.session.timezone}
                    onChange={(v) => updateConfig((d) => { d.session.timezone = v; })}
                    hint="IANA timezone for the session."
                  />
                  <div className="bg-[var(--sf)] border border-[var(--ln)] rounded-lg p-3 space-y-1">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-[var(--ink)]">Market session</span>
                      <span className="font-mono-tabular font-semibold text-[var(--sell)]">
                        09:15 – 15:15
                      </span>
                    </div>
                    <p className="text-[11px] text-[var(--mut)] leading-snug">
                      Fixed 6hr session from 09:15 to 15:15 (entire market day ·{' '}
                      <span className="font-mono-tabular text-[var(--ink)]">21,600 s</span>).
                    </p>
                  </div>
                </ControlCard>

                <ControlCard
                  title="Market & Reproducibility"
                  subtitle="Instrument universe slice, fallback regimes, and PRNG seed."
                >
                  <RangeKnob
                    label="Instrument count"
                    keyPath="market.instrument_count"
                    min={1}
                    max={Math.max(1, config.instruments.length)}
                    step={1}
                    value={config.market.instrument_count}
                    onChange={(v) => updateConfig((d) => { d.market.instrument_count = v; })}
                    hint="First N rows from instruments.yaml are simulated and selectable in Market view."
                  />
                  <SelectControl
                    label="Default volatility regime"
                    keyPath="market.volatility_regime"
                    value={config.market.volatility_regime}
                    options={['LOW', 'MEDIUM', 'HIGH']}
                    onChange={(v) =>
                      updateConfig((d) => {
                        d.market.volatility_regime = v as Regime;
                      })
                    }
                  />
                  <SelectControl
                    label="Default liquidity regime"
                    keyPath="market.liquidity_regime"
                    value={config.market.liquidity_regime}
                    options={['LOW', 'MEDIUM', 'HIGH']}
                    onChange={(v) =>
                      updateConfig((d) => {
                        d.market.liquidity_regime = v as Regime;
                      })
                    }
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        updateConfig((d) => {
                          d.instruments.forEach((inst) => {
                            inst.volatility_regime = d.market.volatility_regime;
                            inst.liquidity_regime = d.market.liquidity_regime;
                          });
                        });
                        setStatusLog(
                          `Applied ${config.market.volatility_regime}/${config.market.liquidity_regime} regimes across all ${config.instruments.length} instrument rows.`
                        );
                      }}
                      className="px-2.5 py-1 text-[11px] font-medium rounded-lg border border-[var(--ln)] bg-[var(--sf)] text-[var(--ink)] hover:bg-[var(--sf-alt)] cursor-pointer"
                    >
                      Apply defaults to all instruments
                    </button>
                  </div>
                  <RangeKnob
                    label="Random seed"
                    keyPath="reproducibility.random_seed"
                    min={1}
                    max={9999}
                    step={1}
                    value={config.reproducibility.random_seed}
                    onChange={(v) => updateConfig((d) => { d.reproducibility.random_seed = v; })}
                    hint="CLI --seed / reproducibility.random_seed"
                  />
                </ControlCard>
              </div>

              {/* Editable Instruments Table */}
              <ControlCard
                title="Instruments"
                subtitle={`Editable instruments.yaml rows — first ${config.market.instrument_count} active; remaining rows inactive.`}
              >
                <div className="overflow-x-auto border border-[var(--ln)] rounded-lg">
                  <table className="w-full border-collapse text-xs font-mono-tabular min-w-[700px]">
                    <thead>
                      <tr className="bg-[var(--sf)] border-b border-[var(--ln)] text-[var(--mut)]">
                        <th className="text-left px-2.5 py-2 font-medium">ID</th>
                        <th className="text-left px-2.5 py-2 font-medium">Symbol</th>
                        <th className="text-right px-2.5 py-2 font-medium">Tick</th>
                        <th className="text-right px-2.5 py-2 font-medium">Lot</th>
                        <th className="text-right px-2.5 py-2 font-medium">Ref px</th>
                        <th className="text-left px-2.5 py-2 font-medium">Vol</th>
                        <th className="text-left px-2.5 py-2 font-medium">Liq</th>
                      </tr>
                    </thead>
                    <tbody>
                      {config.instruments.map((inst, idx) => {
                        const active = idx < config.market.instrument_count;
                        return (
                          <tr
                            key={`${idx}-${inst.instrument_id}`}
                            className={`border-b border-[var(--ln)]/60 ${
                              active ? 'bg-[var(--sf)]' : 'bg-[var(--bg)] opacity-45'
                            }`}
                          >
                            <td className="px-2 py-1.5">
                              <input
                                type="text"
                                value={inst.instrument_id}
                                aria-label={`Instrument ${idx + 1} ID`}
                                onChange={(e) =>
                                  updateConfig((d) => {
                                    d.instruments[idx].instrument_id = e.target.value;
                                  })
                                }
                                className="w-full min-w-[140px] bg-transparent border border-[var(--ln)] rounded px-2 py-1 text-[var(--ink)]"
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <input
                                type="text"
                                value={inst.symbol}
                                aria-label={`Instrument ${idx + 1} Symbol`}
                                onChange={(e) =>
                                  updateConfig((d) => {
                                    d.instruments[idx].symbol = e.target.value;
                                  })
                                }
                                className="w-24 bg-transparent border border-[var(--ln)] rounded px-2 py-1 text-[var(--ink)] font-semibold"
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <input
                                type="number"
                                step="0.01"
                                min="0.01"
                                value={inst.tick_size}
                                aria-label={`Instrument ${idx + 1} Tick size`}
                                onChange={(e) =>
                                  updateConfig((d) => {
                                    d.instruments[idx].tick_size = Number(e.target.value) || 0.05;
                                  })
                                }
                                className="w-20 text-right bg-transparent border border-[var(--ln)] rounded px-2 py-1 text-[var(--ink)]"
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <input
                                type="number"
                                step="1"
                                min="1"
                                value={inst.lot_size}
                                aria-label={`Instrument ${idx + 1} Lot size`}
                                onChange={(e) =>
                                  updateConfig((d) => {
                                    d.instruments[idx].lot_size = Number(e.target.value) || 1;
                                  })
                                }
                                className="w-16 text-right bg-transparent border border-[var(--ln)] rounded px-2 py-1 text-[var(--ink)]"
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <input
                                type="number"
                                step="0.05"
                                min="1"
                                value={inst.reference_price}
                                aria-label={`Instrument ${idx + 1} Reference price`}
                                onChange={(e) =>
                                  updateConfig((d) => {
                                    d.instruments[idx].reference_price =
                                      Number(e.target.value) || 100;
                                  })
                                }
                                className="w-24 text-right bg-transparent border border-[var(--ln)] rounded px-2 py-1 text-[var(--ink)]"
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <select
                                value={inst.volatility_regime}
                                aria-label={`Instrument ${idx + 1} Volatility regime`}
                                onChange={(e) =>
                                  updateConfig((d) => {
                                    d.instruments[idx].volatility_regime = e.target.value as Regime;
                                  })
                                }
                                className="bg-transparent border border-[var(--ln)] rounded px-2 py-1 text-[var(--ink)] cursor-pointer"
                              >
                                <option value="LOW">low</option>
                                <option value="MEDIUM">medium</option>
                                <option value="HIGH">high</option>
                              </select>
                            </td>
                            <td className="px-2 py-1.5">
                              <select
                                value={inst.liquidity_regime}
                                aria-label={`Instrument ${idx + 1} Liquidity regime`}
                                onChange={(e) =>
                                  updateConfig((d) => {
                                    d.instruments[idx].liquidity_regime = e.target.value as Regime;
                                  })
                                }
                                className="bg-transparent border border-[var(--ln)] rounded px-2 py-1 text-[var(--ink)] cursor-pointer"
                              >
                                <option value="LOW">low</option>
                                <option value="MEDIUM">medium</option>
                                <option value="HIGH">high</option>
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </ControlCard>
            </div>
          )}

          {/* 2. Market -> Baseline Activity */}
          {runCategory === 'market' && marketSubTab === 'rates' && (() => {
            const decPct = Math.round(config.event_rates.amend_qty_decrease_share * 100);
            const pxPct = Math.round(config.event_rates.amend_price_change_share * 100);
            const incPct = Math.round((config.event_rates.amend_qty_increase_share ?? 0) * 100);
            const totalAmendPct = decPct + pxPct + incPct;
            const remainingAmendPct = Math.max(0, 100 - totalAmendPct);

            return (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <ControlCard
                  title="Arrival mix"
                  subtitle={`cancel_rate + amend_rate must stay below 1.00 (currently ${(
                    config.event_rates.cancel_rate + config.event_rates.amend_rate
                  ).toFixed(2)}).`}
                >
                  <RangeKnob
                    label="Background events / s"
                    keyPath="event_rates.background_events_per_second"
                    min={0.5}
                    max={40}
                    step={0.5}
                    value={config.event_rates.background_events_per_second}
                    onChange={(v) =>
                      updateConfig((d) => {
                        d.event_rates.background_events_per_second = v;
                      })
                    }
                    hint="Base rate before liquidity, volatility, and intraday U-shape multipliers."
                  />
                  <RangeKnob
                    label="Cancel rate"
                    keyPath="event_rates.cancel_rate"
                    min={0}
                    max={0.9}
                    step={0.01}
                    value={config.event_rates.cancel_rate}
                    onChange={(v) =>
                      updateConfig((d) => {
                        d.event_rates.cancel_rate = v;
                      })
                    }
                    format={(v) => `${Math.round(v * 100)}%`}
                  />
                  <RangeKnob
                    label="Amend rate"
                    keyPath="event_rates.amend_rate"
                    min={0}
                    max={0.9}
                    step={0.01}
                    value={config.event_rates.amend_rate}
                    onChange={(v) =>
                      updateConfig((d) => {
                        d.event_rates.amend_rate = v;
                      })
                    }
                    format={(v) => `${Math.round(v * 100)}%`}
                  />
                  <RangeKnob
                    label="Market-order share"
                    keyPath="event_rates.market_order_share"
                    min={0}
                    max={0.2}
                    step={0.01}
                    value={config.event_rates.market_order_share}
                    onChange={(v) =>
                      updateConfig((d) => {
                        d.event_rates.market_order_share = v;
                      })
                    }
                    format={(v) => `${Math.round(v * 100)}%`}
                    complementLabel="limit orders"
                    hint={`Capped at 20%; remaining ${100 - Math.round(config.event_rates.market_order_share * 100)}% are limit orders.`}
                  />
                  <RangeKnob
                    label="Limit IOC share"
                    keyPath="event_rates.limit_ioc_share"
                    min={0}
                    max={1}
                    step={0.01}
                    value={config.event_rates.limit_ioc_share}
                    onChange={(v) =>
                      updateConfig((d) => {
                        d.event_rates.limit_ioc_share = v;
                      })
                    }
                    format={(v) => `${Math.round(v * 100)}%`}
                    complementLabel="limit DAY orders"
                    hint="Share of limit orders sent as IOC; remaining share is limit DAY orders."
                  />
                </ControlCard>

                <ControlCard
                  title="Participants & amends"
                  subtitle="Zipf participant activity skew and 3-way constrained amend split (must equal 100%)."
                >
                  <RangeKnob
                    label="Participant count"
                    keyPath="event_rates.participant_count"
                    min={2}
                    max={80}
                    step={1}
                    value={config.event_rates.participant_count}
                    onChange={(v) =>
                      updateConfig((d) => {
                        d.event_rates.participant_count = v;
                      })
                    }
                  />
                  <RangeKnob
                    label="Zipf exponent"
                    keyPath="event_rates.participant_zipf_exponent"
                    min={0}
                    max={2.5}
                    step={0.05}
                    value={config.event_rates.participant_zipf_exponent}
                    onChange={(v) =>
                      updateConfig((d) => {
                        d.event_rates.participant_zipf_exponent = v;
                      })
                    }
                  />

                  <div className="bg-[var(--sf)] border border-[var(--ln)] rounded-lg p-2.5 space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] font-mono-tabular">
                      <span className="font-semibold text-[var(--ink)] font-sans">
                        Amend split total (capped at 100%)
                      </span>
                      <span
                        className={
                          totalAmendPct === 100
                            ? 'text-[var(--pass)] font-bold'
                            : 'text-[var(--fail)] font-bold'
                        }
                      >
                        {decPct}% + {pxPct}% + {incPct}% = {totalAmendPct}% / 100%
                        {remainingAmendPct > 0 ? ` (${remainingAmendPct}% left)` : ''}
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-[var(--ln)] overflow-hidden flex">
                      <div
                        style={{ width: `${decPct}%`, backgroundColor: 'var(--sell)' }}
                        title={`Qty decrease: ${decPct}%`}
                      />
                      <div
                        style={{ width: `${pxPct}%`, backgroundColor: 'var(--buy)' }}
                        title={`Price change: ${pxPct}%`}
                      />
                      <div
                        style={{ width: `${incPct}%`, backgroundColor: 'var(--flag)' }}
                        title={`Qty increase: ${incPct}%`}
                      />
                    </div>
                  </div>

                  <RangeKnob
                    label="Amend qty-decrease share"
                    keyPath="event_rates.amend_qty_decrease_share"
                    min={0}
                    max={1}
                    step={0.01}
                    value={config.event_rates.amend_qty_decrease_share}
                    maxSelectable={(100 - pxPct - incPct) / 100}
                    onChange={(v) =>
                      updateConfig((d) => {
                        const maxAllowed = (100 - pxPct - incPct) / 100;
                        d.event_rates.amend_qty_decrease_share = Number(
                          Math.min(v, maxAllowed).toFixed(2)
                        );
                      })
                    }
                    format={(v) => `${Math.round(v * 100)}%`}
                  />
                  <RangeKnob
                    label="Amend price-change share"
                    keyPath="event_rates.amend_price_change_share"
                    min={0}
                    max={1}
                    step={0.01}
                    value={config.event_rates.amend_price_change_share}
                    maxSelectable={(100 - decPct - incPct) / 100}
                    onChange={(v) =>
                      updateConfig((d) => {
                        const maxAllowed = (100 - decPct - incPct) / 100;
                        d.event_rates.amend_price_change_share = Number(
                          Math.min(v, maxAllowed).toFixed(2)
                        );
                      })
                    }
                    format={(v) => `${Math.round(v * 100)}%`}
                  />
                  <RangeKnob
                    label="Amend qty-increase share"
                    keyPath="event_rates.amend_qty_increase_share"
                    min={0}
                    max={1}
                    step={0.01}
                    value={config.event_rates.amend_qty_increase_share ?? 0}
                    maxSelectable={(100 - decPct - pxPct) / 100}
                    onChange={(v) =>
                      updateConfig((d) => {
                        const maxAllowed = (100 - decPct - pxPct) / 100;
                        d.event_rates.amend_qty_increase_share = Number(
                          Math.min(v, maxAllowed).toFixed(2)
                        );
                      })
                    }
                    format={(v) => `${Math.round(v * 100)}%`}
                  />
                </ControlCard>

                <ControlCard
                  className="md:col-span-2"
                  title="Live estimated events / sec per instrument"
                  subtitle="Combines background_events_per_second × liquidity multiplier × volatility activity scale × intraday U-shape across the 6hr session."
                >
                  <div className="overflow-x-auto border border-[var(--ln)] rounded-lg">
                    <table className="w-full border-collapse text-xs font-mono-tabular min-w-[680px]">
                      <thead>
                        <tr className="bg-[var(--sf)] border-b border-[var(--ln)] text-[var(--mut)]">
                          <th className="text-left px-3 py-2 font-medium font-sans">Instrument</th>
                          <th className="text-left px-3 py-2 font-medium font-sans">Regime (Vol / Liq)</th>
                          <th className="text-right px-3 py-2 font-medium font-sans">Multipliers (Base × Liq × Vol)</th>
                          <th className="text-right px-3 py-2 font-medium font-sans">Session avg / s</th>
                          <th className="text-right px-3 py-2 font-medium font-sans">Open peak (09:15)</th>
                          <th className="text-right px-3 py-2 font-medium font-sans">Close peak (15:15)</th>
                          <th className="text-right px-3 py-2 font-medium font-sans">Est. 6hr events</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rateEstimates.map((est) => (
                          <tr
                            key={est.instrument_id}
                            className="border-b border-[var(--ln)]/60 last:border-b-0 bg-[var(--sf)]"
                          >
                            <td className="px-3 py-2 font-semibold text-[var(--ink)]">
                              {est.symbol}
                            </td>
                            <td className="px-3 py-2 text-[var(--mut)]">
                              {est.volatility_regime} / {est.liquidity_regime}
                            </td>
                            <td className="px-3 py-2 text-right text-[var(--mut)]">
                              {est.baseRate.toFixed(1)} × {est.liqMultiplier.toFixed(2)} ×{' '}
                              {est.volScale.toFixed(2)} ={' '}
                              <span className="text-[var(--ink)]">
                                {est.steadyEventsPerSec.toFixed(1)}/s
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right font-bold text-[var(--sell)]">
                              {est.avgEventsPerSec.toFixed(2)} ev/s
                            </td>
                            <td className="px-3 py-2 text-right text-[var(--ink)]">
                              {est.openEventsPerSec.toFixed(2)} ev/s
                            </td>
                            <td className="px-3 py-2 text-right text-[var(--ink)]">
                              {est.closeEventsPerSec.toFixed(2)} ev/s
                            </td>
                            <td className="px-3 py-2 text-right font-semibold text-[var(--ink)]">
                              ~{est.estimatedSessionEvents.toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </ControlCard>
              </div>
            );
          })()}

          {/* 3. Measurement -> Book & Features */}
          {runCategory === 'measurement' && measurementSubTab === 'book' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <ControlCard
                title="Book & snapshots"
                subtitle="L2 output depth, cadence, SMP policy, and invariant checks."
              >
                <RangeKnob
                  label="Snapshot depth (recorded)"
                  keyPath="book.snapshot_levels_n"
                  min={1}
                  max={6}
                  step={1}
                  value={config.book.snapshot_levels_n}
                  onChange={(v) => updateConfig((d) => { d.book.snapshot_levels_n = v; })}
                  hint="Number of L2 price levels recorded per side in book snapshots (max 6)."
                />
                <SelectControl
                  label="Snapshot mode"
                  keyPath="book.snapshot_mode"
                  value={config.book.snapshot_mode}
                  options={['TIME', 'EVENT', 'BOTH']}
                  onChange={(v) =>
                    updateConfig((d) => {
                      d.book.snapshot_mode = v as SimulationConfig['book']['snapshot_mode'];
                    })
                  }
                />
                <RangeKnob
                  label="Snapshot interval"
                  keyPath="book.snapshot_interval_ms"
                  min={100}
                  max={5000}
                  step={100}
                  value={config.book.snapshot_interval_ms}
                  onChange={(v) => updateConfig((d) => { d.book.snapshot_interval_ms = v; })}
                  format={(v) => `${v} ms`}
                />
                <SelectControl
                  label="Self-match prevention"
                  keyPath="book.self_match_prevention"
                  value={config.book.self_match_prevention}
                  options={['prevent-cancel-resting', 'prevent-cancel-incoming', 'allow']}
                  onChange={(v) =>
                    updateConfig((d) => {
                      d.book.self_match_prevention =
                        v as SimulationConfig['book']['self_match_prevention'];
                    })
                  }
                />
                <RangeKnob
                  label="Full invariant interval"
                  keyPath="book.full_invariant_check_interval"
                  min={0}
                  max={5000}
                  step={50}
                  value={config.book.full_invariant_check_interval}
                  onChange={(v) =>
                    updateConfig((d) => {
                      d.book.full_invariant_check_interval = v;
                    })
                  }
                />
                <SelectControl
                  label="Internal precision"
                  keyPath="timing.internal_precision"
                  value={config.timing.internal_precision}
                  options={['MICROSECOND', 'MILLISECOND']}
                  onChange={(v) =>
                    updateConfig((d) => {
                      d.timing.internal_precision =
                        v as SimulationConfig['timing']['internal_precision'];
                    })
                  }
                />
                <SelectControl
                  label="Export precision"
                  keyPath="timing.export_precision"
                  value={config.timing.export_precision}
                  options={['MICROSECOND', 'MILLISECOND']}
                  onChange={(v) =>
                    updateConfig((d) => {
                      d.timing.export_precision =
                        v as SimulationConfig['timing']['export_precision'];
                    })
                  }
                />
              </ControlCard>

              <ControlCard
                title="Features"
                subtitle="Top-N level depth (depth_n) and %-band depth (depth_band_pct) are kept as deliberate, documented depth measures. Sample rate drives baseline windows."
              >
                <RangeKnob
                  label="Feature depth (measured)"
                  keyPath="features.depth_n"
                  min={1}
                  max={20}
                  step={1}
                  value={config.features.depth_n}
                  onChange={(v) => updateConfig((d) => { d.features.depth_n = v; })}
                  hint="Top-N price levels measured for level-based depth features (paired with depth_band_pct)."
                />
                <RangeKnob
                  label="Depth band %"
                  keyPath="features.depth_band_pct"
                  min={0.05}
                  max={5}
                  step={0.05}
                  value={config.features.depth_band_pct}
                  onChange={(v) => updateConfig((d) => { d.features.depth_band_pct = v; })}
                  hint="Percentage price-band depth measure documented as an alternative to top-N level depth."
                />
                <RangeKnob
                  label="Group gap"
                  keyPath="features.group_gap_ms"
                  min={100}
                  max={10000}
                  step={100}
                  value={config.features.group_gap_ms}
                  onChange={(v) => updateConfig((d) => { d.features.group_gap_ms = v; })}
                  format={(v) => `${v} ms`}
                />
                <RangeKnob
                  label="Group max span"
                  keyPath="features.group_max_span_ms"
                  min={1000}
                  max={120000}
                  step={1000}
                  value={config.features.group_max_span_ms}
                  onChange={(v) => updateConfig((d) => { d.features.group_max_span_ms = v; })}
                  format={(v) => `${v} ms`}
                />
                <RangeKnob
                  label="Trailing window"
                  keyPath="features.trailing_window_ms"
                  min={0}
                  max={30000}
                  step={250}
                  value={config.features.trailing_window_ms}
                  onChange={(v) => updateConfig((d) => { d.features.trailing_window_ms = v; })}
                  format={(v) => `${v} ms`}
                />
                <RangeKnob
                  label="Background order sample rate"
                  keyPath="features.background_order_sample_rate"
                  min={0.01}
                  max={1}
                  step={0.01}
                  value={config.features.background_order_sample_rate}
                  onChange={(v) =>
                    updateConfig((d) => {
                      d.features.background_order_sample_rate = v;
                    })
                  }
                  format={(v) => `${Math.round(v * 100)}%`}
                />
              </ControlCard>
            </div>
          )}

          {/* 4. Episodes -> Shared Scenario */}
          {runCategory === 'episodes' && episodesSubTab === 'scenario' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <ControlCard title="Placement" subtitle="Shared spacing through the session.">
                  <RangeKnob
                    label="Scenario slot"
                    keyPath="scenario.scenario_slot_s"
                    min={10}
                    max={180}
                    step={1}
                    value={config.scenario.scenario_slot_s}
                    onChange={(v) => updateConfig((d) => { d.scenario.scenario_slot_s = v; })}
                    format={(v) => `${v} s`}
                  />
                  <RangeKnob
                    label="Warm-up"
                    keyPath="scenario.warmup_frac"
                    min={0}
                    max={0.4}
                    step={0.01}
                    value={config.scenario.warmup_frac}
                    onChange={(v) => updateConfig((d) => { d.scenario.warmup_frac = v; })}
                    format={(v) => `${Math.round(v * 100)}%`}
                  />
                  <RangeKnob
                    label="Cool-down"
                    keyPath="scenario.cooldown_frac"
                    min={0}
                    max={0.4}
                    step={0.01}
                    value={config.scenario.cooldown_frac}
                    onChange={(v) => updateConfig((d) => { d.scenario.cooldown_frac = v; })}
                    format={(v) => `${Math.round(v * 100)}%`}
                  />
                  {renderSharedKnob('difficulty')}
                </ControlCard>

                <ControlCard
                  title="Size, layers, timing"
                  subtitle="Used only by scripts that call shared helpers."
                >
                  {renderSharedKnob('large_depth_multiple')}
                  {renderSharedKnob('layer_count')}
                  {renderSharedKnob('layer_price_step_ticks')}
                  {renderSharedKnob('layer_volume_decay')}
                  {renderSharedKnob('display_duration_s')}
                  {renderSharedKnob('hold_duration_s')}
                </ControlCard>

                <ControlCard
                  title="Resting time, fills, jitter"
                  subtitle="Eligible layered and control types."
                >
                  {renderSharedKnob('resting_time')}
                  <ToggleControl
                    label="Partial fills enabled"
                    keyPath="scenario.partial_fill_enabled"
                    checked={config.scenario.partial_fill_enabled}
                    onChange={(v) =>
                      updateConfig((d) => {
                        d.scenario.partial_fill_enabled = v;
                      })
                    }
                    hint="Does not control S02's 30–70% fill."
                  />
                  {renderSharedKnob('partial_fill')}
                  <RangeKnob
                    label="Partial-fill ratio"
                    keyPath="scenario.partial_fill_min_ratio / max_ratio"
                    min={0}
                    max={1}
                    step={0.01}
                    value={config.scenario.partial_fill_min_ratio}
                    rangeMaxValue={config.scenario.partial_fill_max_ratio}
                    onChange={(v) =>
                      updateConfig((d) => {
                        d.scenario.partial_fill_min_ratio = v;
                      })
                    }
                    onChangeRangeMax={(v) =>
                      updateConfig((d) => {
                        d.scenario.partial_fill_max_ratio = v;
                      })
                    }
                    format={(v) => `${Math.round(v * 100)}%`}
                  />
                  <ToggleControl
                    label="Latency jitter"
                    keyPath="scenario.latency_jitter_enabled"
                    checked={config.scenario.latency_jitter_enabled}
                    onChange={(v) =>
                      updateConfig((d) => {
                        d.scenario.latency_jitter_enabled = v;
                      })
                    }
                  />
                  {renderSharedKnob('latency_jitter')}
                  {renderSharedKnob('blend_actors')}
                </ControlCard>
              </div>
            </div>
          )}

          {/* 4b. Episodes -> Per-type Instance Counts */}
          {runCategory === 'episodes' && episodesSubTab === 'counts' && (
            <ControlCard
              title="Per-type instance counts"
              subtitle="This is the main per-type YAML setting. Click any type in Scenario library to inspect script constraints."
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {SCENARIO_DEFINITIONS.map((sc) => (
                  <RangeKnob
                    key={sc.id}
                    label={`${sc.id} · ${sc.role === 'control' ? 'Ctrl' : 'Pattern'}`}
                    keyPath={`scenario.scenario_instances.${sc.id}`}
                    min={0}
                    max={40}
                    step={1}
                    value={config.scenario.scenario_instances[sc.id]}
                    onChange={(v) =>
                      updateConfig((d) => {
                        d.scenario.scenario_instances[sc.id] = v;
                      })
                    }
                    hint={sc.name}
                  />
                ))}
              </div>
            </ControlCard>
          )}

          {/* 5. Market -> Regimes */}
          {runCategory === 'market' && marketSubTab === 'regimes' && (
            <div className="space-y-4">
              <div className="bg-[var(--bg)] border border-[var(--ln)] rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-[var(--ink)]">
                  Live effective rate per instrument (incl. U-shape):
                </span>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono-tabular">
                  {rateEstimates.map((est) => (
                    <span key={est.instrument_id} className="text-[var(--mut)]">
                      <span className="font-semibold text-[var(--ink)]">{est.symbol}</span>:{' '}
                      <span className="text-[var(--sell)] font-semibold">
                        {est.avgEventsPerSec.toFixed(1)} ev/s avg
                      </span>{' '}
                      (open {est.openEventsPerSec.toFixed(1)} · close {est.closeEventsPerSec.toFixed(1)})
                    </span>
                  ))}
                </div>
              </div>
              <ControlCard
                title="Mean reversion & intraday U-shape"
                subtitle="Mid-price pull-back and intraday activity boosts near open and close."
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <RangeKnob
                    label="Mean reversion / s"
                    keyPath="regimes.mean_reversion_per_s"
                    min={0}
                    max={0.02}
                    step={0.0005}
                    value={config.regimes.mean_reversion_per_s}
                    onChange={(v) =>
                      updateConfig((d) => {
                        d.regimes.mean_reversion_per_s = v;
                      })
                    }
                  />
                  <RangeKnob
                    label="Open boost"
                    keyPath="regimes.intraday_profile.open_boost"
                    min={1}
                    max={6}
                    step={0.1}
                    value={config.regimes.intraday_profile.open_boost}
                    onChange={(v) =>
                      updateConfig((d) => {
                        d.regimes.intraday_profile.open_boost = v;
                      })
                    }
                  />
                  <RangeKnob
                    label="Close boost"
                    keyPath="regimes.intraday_profile.close_boost"
                    min={1}
                    max={6}
                    step={0.1}
                    value={config.regimes.intraday_profile.close_boost}
                    onChange={(v) =>
                      updateConfig((d) => {
                        d.regimes.intraday_profile.close_boost = v;
                      })
                    }
                  />
                  <RangeKnob
                    label="Decay minutes"
                    keyPath="regimes.intraday_profile.decay_minutes"
                    min={5}
                    max={90}
                    step={1}
                    value={config.regimes.intraday_profile.decay_minutes}
                    onChange={(v) =>
                      updateConfig((d) => {
                        d.regimes.intraday_profile.decay_minutes = v;
                      })
                    }
                  />
                </div>
              </ControlCard>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {(['LOW', 'MEDIUM', 'HIGH'] as Regime[]).map((r) => (
                  <ControlCard
                    key={`vol-${r}`}
                    title={`Volatility · ${r.toLowerCase()}`}
                    subtitle="Price-path stochastic volatility and activity coupling."
                  >
                    <RangeKnob
                      label="σ bps / √s"
                      keyPath={`regimes.volatility.${r}.sigma_bps_per_sqrt_s`}
                      min={0.05}
                      max={4}
                      step={0.05}
                      value={config.regimes.volatility[r].sigma_bps_per_sqrt_s}
                      onChange={(v) =>
                        updateConfig((d) => {
                          d.regimes.volatility[r].sigma_bps_per_sqrt_s = v;
                        })
                      }
                    />
                    <RangeKnob
                      label="Vol of vol"
                      keyPath={`regimes.volatility.${r}.vol_of_vol`}
                      min={0}
                      max={1}
                      step={0.01}
                      value={config.regimes.volatility[r].vol_of_vol}
                      onChange={(v) =>
                        updateConfig((d) => {
                          d.regimes.volatility[r].vol_of_vol = v;
                        })
                      }
                    />
                    <RangeKnob
                      label="Vol persistence"
                      keyPath={`regimes.volatility.${r}.vol_persistence`}
                      min={0.9}
                      max={0.999}
                      step={0.001}
                      value={config.regimes.volatility[r].vol_persistence}
                      onChange={(v) =>
                        updateConfig((d) => {
                          d.regimes.volatility[r].vol_persistence = v;
                        })
                      }
                    />
                    <RangeKnob
                      label="Activity exponent"
                      keyPath={`regimes.volatility.${r}.activity_exponent`}
                      min={0}
                      max={2}
                      step={0.05}
                      value={config.regimes.volatility[r].activity_exponent}
                      onChange={(v) =>
                        updateConfig((d) => {
                          d.regimes.volatility[r].activity_exponent = v;
                        })
                      }
                    />
                  </ControlCard>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {(['LOW', 'MEDIUM', 'HIGH'] as Regime[]).map((r) => (
                  <ControlCard
                    key={`liq-${r}`}
                    title={`Liquidity · ${r.toLowerCase()}`}
                    subtitle="Depth, lognormal size, seed book, and arrival rate multiplier."
                  >
                    <RangeKnob
                      label="Depth scale"
                      keyPath={`regimes.liquidity.${r}.depth_scale`}
                      min={0.1}
                      max={5}
                      step={0.1}
                      value={config.regimes.liquidity[r].depth_scale}
                      onChange={(v) =>
                        updateConfig((d) => {
                          d.regimes.liquidity[r].depth_scale = v;
                        })
                      }
                    />
                    <RangeKnob
                      label="Size median"
                      keyPath={`regimes.liquidity.${r}.size_median`}
                      min={5}
                      max={800}
                      step={5}
                      value={config.regimes.liquidity[r].size_median}
                      onChange={(v) =>
                        updateConfig((d) => {
                          d.regimes.liquidity[r].size_median = v;
                        })
                      }
                    />
                    <RangeKnob
                      label="Size σ"
                      keyPath={`regimes.liquidity.${r}.size_sigma`}
                      min={0.1}
                      max={2}
                      step={0.05}
                      value={config.regimes.liquidity[r].size_sigma}
                      onChange={(v) =>
                        updateConfig((d) => {
                          d.regimes.liquidity[r].size_sigma = v;
                        })
                      }
                    />
                    <RangeKnob
                      label="Size max"
                      keyPath={`regimes.liquidity.${r}.size_max`}
                      min={100}
                      max={50000}
                      step={100}
                      value={config.regimes.liquidity[r].size_max}
                      onChange={(v) =>
                        updateConfig((d) => {
                          d.regimes.liquidity[r].size_max = v;
                        })
                      }
                    />
                    <RangeKnob
                      label="Half-spread ticks"
                      keyPath={`regimes.liquidity.${r}.half_spread_ticks`}
                      min={0}
                      max={8}
                      step={0.5}
                      value={config.regimes.liquidity[r].half_spread_ticks}
                      onChange={(v) =>
                        updateConfig((d) => {
                          d.regimes.liquidity[r].half_spread_ticks = v;
                        })
                      }
                    />
                    <RangeKnob
                      label="Offset scale ticks"
                      keyPath={`regimes.liquidity.${r}.offset_scale_ticks`}
                      min={0.5}
                      max={12}
                      step={0.5}
                      value={config.regimes.liquidity[r].offset_scale_ticks}
                      onChange={(v) =>
                        updateConfig((d) => {
                          d.regimes.liquidity[r].offset_scale_ticks = v;
                        })
                      }
                    />
                    <RangeKnob
                      label="Seed levels"
                      keyPath={`regimes.liquidity.${r}.seed_levels`}
                      min={1}
                      max={20}
                      step={1}
                      value={config.regimes.liquidity[r].seed_levels}
                      onChange={(v) =>
                        updateConfig((d) => {
                          d.regimes.liquidity[r].seed_levels = v;
                        })
                      }
                    />
                    <RangeKnob
                      label="Seed orders / level"
                      keyPath={`regimes.liquidity.${r}.seed_orders_per_level`}
                      min={1}
                      max={8}
                      step={1}
                      value={config.regimes.liquidity[r].seed_orders_per_level}
                      onChange={(v) =>
                        updateConfig((d) => {
                          d.regimes.liquidity[r].seed_orders_per_level = v;
                        })
                      }
                    />
                    <RangeKnob
                      label="Rate multiplier"
                      keyPath={`regimes.liquidity.${r}.rate_multiplier`}
                      min={0.1}
                      max={4}
                      step={0.1}
                      value={config.regimes.liquidity[r].rate_multiplier}
                      onChange={(v) =>
                        updateConfig((d) => {
                          d.regimes.liquidity[r].rate_multiplier = v;
                        })
                      }
                    />
                  </ControlCard>
                ))}
              </div>
            </div>
          )}

          {/* 6. Episodes -> Scenario Library (16) */}
          {runCategory === 'episodes' && episodesSubTab === 'scenarios' && !activeScenario && (
        <div className="space-y-5">
          {SCENARIO_GROUPS.map((groupName) => {
            const items = SCENARIO_DEFINITIONS.filter((s) => s.group === groupName);
            return (
              <div key={groupName} className="space-y-2.5">
                <div className="flex items-center justify-between border-b border-[var(--ln)] pb-1.5">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--ink)]">
                    {groupName}
                  </h3>
                  <span className="text-xs font-mono-tabular text-[var(--mut)]">
                    {items.length} scripts
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {items.map((sc) => {
                    const count = config.scenario.scenario_instances[sc.id] ?? 0;
                    return (
                      <button
                        key={sc.id}
                        type="button"
                        onClick={() => setActiveScenarioId(sc.id)}
                        className="text-left bg-[var(--bg)] border border-[var(--ln)] hover:border-[var(--ink)] rounded-xl p-3.5 transition-colors cursor-pointer space-y-1.5 flex flex-col justify-between"
                      >
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between gap-2 text-xs font-mono-tabular">
                            <span
                              className={`font-bold ${
                                sc.role === 'control' ? 'text-[var(--look)]' : 'text-[var(--flag)]'
                              }`}
                            >
                              {sc.id} · {sc.role === 'control' ? 'Control' : 'Pattern'}
                            </span>
                            <span className="font-semibold text-[var(--ink)]">{count}×</span>
                          </div>
                          <div className="text-sm font-bold text-[var(--ink)] leading-snug">
                            {sc.name}
                          </div>
                          <p className="text-xs text-[var(--mut)] leading-relaxed">{sc.desc}</p>
                        </div>
                        <div className="pt-2 text-[11px] font-mono-tabular text-[var(--mut)]">
                          {sc.script} · {sc.knobs.length} shared knobs
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

          {/* EPISODES -> SCENARIO LIBRARY DETAIL VIEW */}
          {runCategory === 'episodes' && episodesSubTab === 'scenarios' && activeScenario && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setActiveScenarioId(null)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-[var(--ln)] bg-[var(--bg)] text-[var(--ink)] hover:bg-[var(--sf-alt)] cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              All scenarios
            </button>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-[var(--mut)]">Quick count:</span>
              {[0, 1, 2, 5].map((n) => {
                const active = config.scenario.scenario_instances[activeScenario.id] === n;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() =>
                      updateConfig((d) => {
                        d.scenario.scenario_instances[activeScenario.id] = n;
                      })
                    }
                    className={`px-2.5 py-1 text-xs font-mono-tabular font-semibold rounded-lg border cursor-pointer ${
                      active
                        ? 'bg-[var(--ink)] text-[var(--bg)] border-[var(--ink)]'
                        : 'bg-[var(--bg)] text-[var(--ink)] border-[var(--ln)] hover:bg-[var(--sf-alt)]'
                    }`}
                  >
                    {n}×
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => handleGenerate(activeScenario.id)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--sell)] text-white hover:opacity-90 cursor-pointer"
              >
                <Play className="w-3.5 h-3.5" />
                Generate {activeScenario.id} only
              </button>
            </div>
          </div>

          {/* Scenario Header & Taxonomy */}
          <div className="bg-[var(--bg)] border border-[var(--ln)] rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-xs font-mono-tabular text-[var(--mut)]">
                  {activeScenario.id} · {activeScenario.group} · {activeScenario.script}
                </div>
                <h3 className="text-base font-bold text-[var(--ink)]">{activeScenario.name}</h3>
                <p className="text-xs text-[var(--mut)]">{activeScenario.desc}</p>
              </div>
              <div className="text-right font-mono-tabular text-xs space-y-0.5">
                <div
                  className={`font-bold ${
                    activeScenario.role === 'control'
                      ? 'text-[var(--look)]'
                      : 'text-[var(--flag)]'
                  }`}
                >
                  {activeScenario.role === 'control'
                    ? 'Benign look-alike control · not a positive abuse label'
                    : 'Manipulative-pattern test'}
                </div>
                <div className="text-[var(--mut)]">
                  {activeScenario.family} · {activeScenario.category}
                </div>
              </div>
            </div>

            {activeScenario.extra && (
              <div className="text-xs text-[var(--ink)] bg-[var(--sf)] border border-[var(--ln)] rounded-lg px-3 py-2">
                {activeScenario.extra}
              </div>
            )}

            <div className="pt-2 border-t border-[var(--ln)]/70 space-y-1">
              <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--mut)]">
                Fixed script constraints
              </div>
              <ul className="space-y-1 text-xs text-[var(--ink)]">
                {activeScenario.fixed.map((f, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-[var(--sell)] font-mono-tabular">◆</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Knobs for this Scenario */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ControlCard
              title="This type only"
              subtitle={`scenario.scenario_instances.${activeScenario.id}`}
            >
              <RangeKnob
                label="Occurrences in this run"
                keyPath={`scenario.scenario_instances.${activeScenario.id}`}
                min={0}
                max={40}
                step={1}
                value={config.scenario.scenario_instances[activeScenario.id]}
                onChange={(v) =>
                  updateConfig((d) => {
                    d.scenario.scenario_instances[activeScenario.id] = v;
                  })
                }
                hint="How many instances of this script are planned into the active window."
              />
              <div className="text-xs text-[var(--mut)] bg-[var(--sf)] border border-[var(--ln)] rounded-lg p-3">
                <strong className="text-[var(--ink)]">Locked in the script:</strong>{' '}
                {activeScenario.fixed[0]} Shared YAML parameters still flow through existing
                helpers — per-type override blocks are intentionally omitted.
              </div>
            </ControlCard>

            <ControlCard
              title="Shared knobs that apply"
              subtitle="Changing these also affects other types that call the same shared helper."
            >
              {activeScenario.knobs.length > 0 ? (
                activeScenario.knobs.map((k) => renderSharedKnob(k))
              ) : (
                <p className="text-xs text-[var(--mut)]">
                  Only instance count is independently configurable for this type.
                </p>
              )}
            </ControlCard>
          </div>

          {/* Session Placement Preview Timeline */}
          <ControlCard
            title="Session placement preview"
            subtitle={`Warm-up ${Math.round(config.scenario.warmup_frac * 100)}% · Active ${Math.round(
              Math.max(0, 1 - config.scenario.warmup_frac - config.scenario.cooldown_frac) * 100
            )}% · Cool-down ${Math.round(config.scenario.cooldown_frac * 100)}%`}
          >
            {(() => {
              const warmPct = config.scenario.warmup_frac * 100;
              const coolPct = config.scenario.cooldown_frac * 100;
              const activePct = Math.max(0, 100 - warmPct - coolPct);
              const thisCount = config.scenario.scenario_instances[activeScenario.id] ?? 0;
              const shown = Math.min(thisCount, Math.max(capacity.approx_capacity, 1));
              const overflow = capacity.requested_instances > capacity.approx_capacity;
              return (
                <div className="space-y-2">
                  <div className="h-7 w-full rounded-lg border border-[var(--ln)] overflow-hidden flex bg-[var(--sf)]">
                    <div
                      style={{ width: `${warmPct}%` }}
                      className="bg-[var(--look)]/20 border-r border-[var(--ln)] h-full"
                      title={`Warm-up: ${capacity.warmup_s}s`}
                    />
                    <div
                      style={{ width: `${activePct}%` }}
                      className="bg-[var(--buy)]/15 relative h-full"
                      title={`Active placement window: ${capacity.active_s}s`}
                    >
                      {Array.from({ length: shown }, (_, i) => (
                        <span
                          key={i}
                          className="absolute top-1 bottom-1 w-1 rounded-full"
                          style={{
                            left: `${((i + 0.5) / Math.max(1, shown)) * 100}%`,
                            backgroundColor:
                              activeScenario.role === 'control' ? 'var(--look)' : 'var(--flag)',
                          }}
                        />
                      ))}
                    </div>
                    <div
                      style={{ width: `${coolPct}%` }}
                      className="bg-[var(--mut)]/20 border-l border-[var(--ln)] h-full"
                      title={`Cool-down: ${capacity.cooldown_s}s`}
                    />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono-tabular">
                    <span className="text-[var(--mut)]">
                      {thisCount} of {activeScenario.id} · {capacity.requested_instances} total
                      instances
                    </span>
                    <span className={overflow ? 'text-[var(--fail)] font-semibold' : 'text-[var(--mut)]'}>
                      ~{capacity.approx_capacity} non-overlapping slots across {capacity.instruments}{' '}
                      instrument(s)
                    </span>
                  </div>
                </div>
              );
            })()}
          </ControlCard>
        </div>
          )}
        </div>
      )}

      {/* MODE 2: LAUNCH & PRESETS */}
      {mode === 'launch' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ControlCard
              title="CLI-equivalent launch"
              subtitle="Same flags as python -m surveillance_sim.cli generate."
            >
              <SelectControl
                label="Export format"
                keyPath="launch.fmt"
                value={launch.fmt}
                options={['parquet', 'csv']}
                onChange={(v) => setLaunch((p) => ({ ...p, fmt: v as 'parquet' | 'csv' }))}
              />
              <TextControl
                label="Export directory"
                keyPath="launch.out"
                value={launch.out}
                onChange={(v) => setLaunch((p) => ({ ...p, out: v }))}
              />
              <ToggleControl
                label="Validation gate (off = --no-gate)"
                keyPath="launch.gate"
                checked={launch.gate}
                onChange={(v) => setLaunch((p) => ({ ...p, gate: v }))}
                hint="Marks run FAILED if DQ defects or S16 anomalies trigger gate checks."
              />
              <ToggleControl
                label="Replay check"
                keyPath="validation.replay_check"
                checked={config.validation.replay_check}
                onChange={(v) =>
                  updateConfig((d) => {
                    d.validation.replay_check = v;
                  })
                }
              />
              <RangeKnob
                label="Max regeneration attempts"
                keyPath="validation.max_regeneration_attempts"
                min={0}
                max={8}
                step={1}
                value={config.validation.max_regeneration_attempts}
                onChange={(v) =>
                  updateConfig((d) => {
                    d.validation.max_regeneration_attempts = v;
                  })
                }
              />
              <RangeKnob
                label="Inject synthetic DQ defects"
                keyPath="launch.defectRatePct"
                min={0}
                max={8}
                step={0.5}
                value={launch.defectRatePct}
                onChange={(v) => setLaunch((p) => ({ ...p, defectRatePct: v }))}
                format={(v) => `${v.toFixed(1)}%`}
                hint="Stress-test quality.validation_results & Data quality tab (0% = clean)."
              />
            </ControlCard>

            <ControlCard
              title="Run size presets"
              subtitle="Session is fixed at 09:15–15:15 (6 hours). Presets adjust S01–S16 scenario instance counts."
            >
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => applyPreset('quick')}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-[var(--ln)] bg-[var(--sf)] text-[var(--ink)] hover:bg-[var(--sf-alt)] cursor-pointer"
                >
                  Quick (6h · 1×)
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset('demo')}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-[var(--ln)] bg-[var(--sf)] text-[var(--ink)] hover:bg-[var(--sf-alt)] cursor-pointer"
                >
                  Makefile demo (6h · 2×)
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset('yaml')}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-[var(--ln)] bg-[var(--sf)] text-[var(--ink)] hover:bg-[var(--sf-alt)] cursor-pointer"
                >
                  YAML counts (6h · 25×)
                </button>
              </div>
            </ControlCard>
          </div>
        </div>
      )}

      {/* Persistent Generation Footer */}
      <div className="bg-[var(--bg)] border border-[var(--ln)] rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5">
            <div className="text-xs font-mono-tabular text-[var(--ink)]">
              Slot capacity: ~{capacity.approx_capacity} ({capacity.slots_per_instrument}/inst ×{' '}
              {capacity.instruments}) · Requested: {capacity.requested_instances} · Active window:{' '}
              {capacity.active_s}s / {capacity.session_s}s
            </div>
            <div className="text-xs text-[var(--mut)]">{statusLog}</div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleValidate}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-[var(--ln)] bg-[var(--sf)] text-[var(--ink)] hover:bg-[var(--sf-alt)] whitespace-nowrap cursor-pointer"
            >
              Validate config
            </button>
            <button
              type="button"
              onClick={() => applyPreset('reset')}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg border border-[var(--ln)] bg-[var(--sf)] text-[var(--ink)] hover:bg-[var(--sf-alt)] whitespace-nowrap cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset
            </button>
            <button
              type="button"
              onClick={() =>
                handleDownloadJson({ ...config, launch }, `simulation_config_${configHash.slice(7)}.json`)
              }
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg border border-[var(--ln)] bg-[var(--sf)] text-[var(--ink)] hover:bg-[var(--sf-alt)] whitespace-nowrap cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Export config
            </button>
            <button
              type="button"
              onClick={() => handleGenerate(null)}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-lg bg-[var(--ink)] text-[var(--bg)] hover:opacity-90 whitespace-nowrap cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" />
              Generate synthetic dataset
            </button>
          </div>
        </div>

        {/* Validation Feedback */}
        {validationResult && (validationResult.errors.length > 0 || validationResult.warnings.length > 0) && (
          <div className="space-y-1.5 pt-2 border-t border-[var(--ln)]/70">
            {validationResult.errors.map((err, i) => (
              <div
                key={`err-${i}`}
                className="flex items-start gap-2 text-xs text-[var(--fail)] font-medium"
              >
                <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{err}</span>
              </div>
            ))}
            {validationResult.warnings.map((warn, i) => (
              <div
                key={`warn-${i}`}
                className="flex items-start gap-2 text-xs text-[var(--look)] font-medium"
              >
                <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{warn}</span>
              </div>
            ))}
          </div>
        )}

        {/* Latest Generated Run Summary */}
        {lastGenerated && (
          <div className="pt-3 border-t border-[var(--ln)] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs font-bold text-[var(--ink)]">
                <CheckCircle2
                  className="w-4 h-4 shrink-0"
                  style={{
                    color:
                      lastGenerated.run_metadata.status === 'FAILED'
                        ? 'var(--fail)'
                        : 'var(--pass)',
                  }}
                />
                <span className="font-mono-tabular">{lastGenerated.run_metadata.run_id}</span>
                <span className="text-[var(--mut)]">·</span>
                <span
                  className="font-mono-tabular"
                  style={{
                    color:
                      lastGenerated.run_metadata.status === 'FAILED'
                        ? 'var(--fail)'
                        : 'var(--pass)',
                  }}
                >
                  {lastGenerated.run_metadata.status}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => onNavigateTab('market')}
                  className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-[var(--sell)] text-white hover:opacity-90 cursor-pointer"
                >
                  Inspect in Market view
                </button>
                <button
                  type="button"
                  onClick={() => onNavigateTab('dq')}
                  className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-[var(--ln)] bg-[var(--sf)] text-[var(--ink)] hover:bg-[var(--sf-alt)] cursor-pointer"
                >
                  Data quality
                </button>
                <button
                  type="button"
                  onClick={() => onNavigateTab('det')}
                  className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-[var(--ln)] bg-[var(--sf)] text-[var(--ink)] hover:bg-[var(--sf-alt)] cursor-pointer"
                >
                  Surveillance features
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleDownloadJson(
                      lastGenerated,
                      `${lastGenerated.run_metadata.run_id}.json`
                    )
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg border border-[var(--ln)] bg-[var(--sf)] text-[var(--ink)] hover:bg-[var(--sf-alt)] cursor-pointer"
                >
                  <Download className="w-3 h-3" />
                  Run bundle JSON
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs font-mono-tabular">
              <div className="bg-[var(--sf)] border border-[var(--ln)] rounded-lg px-2.5 py-2">
                <div className="text-[11px] text-[var(--mut)] font-sans">Order events</div>
                <div className="font-bold text-[var(--ink)]">
                  {lastGenerated.model_input.order_events.length.toLocaleString()}
                </div>
              </div>
              <div className="bg-[var(--sf)] border border-[var(--ln)] rounded-lg px-2.5 py-2">
                <div className="text-[11px] text-[var(--mut)] font-sans">Trades</div>
                <div className="font-bold text-[var(--ink)]">
                  {lastGenerated.model_input.trades.length.toLocaleString()}
                </div>
              </div>
              <div className="bg-[var(--sf)] border border-[var(--ln)] rounded-lg px-2.5 py-2">
                <div className="text-[11px] text-[var(--mut)] font-sans">Features</div>
                <div className="font-bold text-[var(--ink)]">
                  {lastGenerated.model_input.surveillance_features.length.toLocaleString()}
                </div>
              </div>
              <div className="bg-[var(--sf)] border border-[var(--ln)] rounded-lg px-2.5 py-2">
                <div className="text-[11px] text-[var(--mut)] font-sans">Scenarios</div>
                <div className="font-bold text-[var(--ink)]">
                  {lastGenerated.evaluator_bundle.scenario_manifest.length}
                </div>
              </div>
              <div className="bg-[var(--sf)] border border-[var(--ln)] rounded-lg px-2.5 py-2">
                <div className="text-[11px] text-[var(--mut)] font-sans">Snapshots</div>
                <div className="font-bold text-[var(--ink)]">
                  {lastGenerated.model_input.book_snapshots.length}
                </div>
              </div>
              <div className="bg-[var(--sf)] border border-[var(--ln)] rounded-lg px-2.5 py-2">
                <div className="text-[11px] text-[var(--mut)] font-sans">Instruments</div>
                <div className="font-bold text-[var(--ink)]">
                  {lastGenerated.instruments && lastGenerated.instruments.length > 1
                    ? `${lastGenerated.instrument_master.symbol} (+${lastGenerated.instruments.length - 1})`
                    : lastGenerated.instrument_master.symbol}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
