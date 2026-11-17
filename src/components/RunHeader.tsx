import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Lock,
  Moon,
  ShieldCheck,
  Sun,
} from 'lucide-react';
import {
  InstrumentMaster,
  ReportArtifactMode,
  RunMetadata,
} from '../types/surveillance';

interface RunHeaderProps {
  runs: Array<{ run_id: string; label: string; status: RunMetadata['status'] }>;
  selectedRunId: string;
  onSelectRun: (runId: string) => void;
  runMetadata: RunMetadata;
  instrument: InstrumentMaster;
  artifactMode: ReportArtifactMode;
  onChangeArtifactMode: (mode: ReportArtifactMode) => void;
  revealLabels: boolean;
  onToggleReveal: (reveal: boolean) => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
}

export const RunHeader: React.FC<RunHeaderProps> = ({
  runs,
  selectedRunId,
  onSelectRun,
  runMetadata,
  instrument,
  artifactMode,
  onChangeArtifactMode,
  revealLabels,
  onToggleReveal,
  darkMode,
  onToggleDarkMode,
}) => {
  const [showConfig, setShowConfig] = useState(false);

  const isModelInputOnly = artifactMode === 'model_input';
  const totalEmbeddedKb = isModelInputOnly
    ? runMetadata.bundle_budget_kb.model_input_kb
    : runMetadata.bundle_budget_kb.model_input_kb +
      runMetadata.bundle_budget_kb.labels_sidecar_kb;
  const budgetPct = Math.min(
    100,
    (totalEmbeddedKb / runMetadata.bundle_budget_kb.max_budget_kb) * 100
  );

  const statusColor =
    runMetadata.status === 'VALIDATED' || runMetadata.status === 'EXPORTED'
      ? 'text-[var(--pass)]'
      : runMetadata.status === 'FAILED'
        ? 'text-[var(--fail)]'
        : 'text-[var(--pend)]';

  return (
    <div className="space-y-3">
      {/* Top Bar (3-zone contract: Title — Snapshot selector & Isolation mode — Theme toggle) */}
      <header className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-[var(--ln)]">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[var(--ink)] whitespace-nowrap shrink-0">
            Surveillance Lab
          </h1>
          <span className="text-xs text-[var(--mut)] hidden sm:inline">
            Multi-schema order-event &amp; scenario report
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-[var(--mut)]">
            <span className="whitespace-nowrap">Exported snapshot</span>
            <select
              value={selectedRunId}
              onChange={(e) => onSelectRun(e.target.value)}
              aria-label="Select exported run snapshot"
              className="font-mono-tabular text-xs bg-[var(--sf)] text-[var(--ink)] border border-[var(--ln)] rounded-lg px-2.5 py-1.5 min-h-[36px] cursor-pointer"
            >
              {runs.map((r) => (
                <option key={r.run_id} value={r.run_id}>
                  {r.label} ({r.status})
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={onToggleDarkMode}
            aria-label={darkMode ? 'Switch to light theme' : 'Switch to dark theme'}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] text-xs font-medium rounded-lg border border-[var(--ln)] bg-[var(--sf)] text-[var(--ink)] hover:bg-[var(--sf-alt)] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {darkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            <span>{darkMode ? 'Light' : 'Dark'}</span>
          </button>
        </div>
      </header>

      {/* Read-only Run Metadata Card (replaces interactive generator form) */}
      <section
        aria-label="Read-only run configuration and metadata"
        className="bg-[var(--sf)] border border-[var(--ln)] rounded-xl p-4 sm:p-5"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-[var(--mut)]">
              <span className="font-semibold text-[var(--ink)]">Read-only run manifest</span>
              <span aria-hidden="true">·</span>
              <span>Generated offline by engine</span>
              <span aria-hidden="true">·</span>
              <span className={`font-semibold font-mono-tabular ${statusColor}`}>
                Gate: {runMetadata.status}
              </span>
            </div>
            <div className="text-lg sm:text-xl font-bold tracking-tight font-mono-tabular text-[var(--ink)]">
              {runMetadata.run_id}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowConfig((v) => !v)}
            aria-expanded={showConfig}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] text-xs font-medium rounded-lg border border-[var(--ln)] bg-[var(--bg)] text-[var(--ink)] hover:bg-[var(--sf-alt)] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <span>{showConfig ? 'Hide config_json & budget' : 'Inspect config_json & budget'}</span>
            {showConfig ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Dense read-only grid from quality.run_metadata & core.instrument_master */}
        <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-5 gap-y-3 mt-4 pt-4 border-t border-[var(--ln)] text-xs">
          <div>
            <dt className="text-[var(--mut)]">Instrument</dt>
            <dd className="font-mono-tabular font-semibold text-[var(--ink)] mt-0.5">
              {instrument.symbol} · {instrument.exchange} ({instrument.instrument_type})
            </dd>
          </div>
          <div>
            <dt className="text-[var(--mut)]">Tick / Lot / Band</dt>
            <dd className="font-mono-tabular font-medium text-[var(--ink)] mt-0.5">
              {instrument.tick_size.toFixed(2)} {instrument.currency} · {instrument.lot_size} ·{' '}
              {instrument.price_band_low.toFixed(0)}–{instrument.price_band_high.toFixed(0)}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--mut)]">Regime (Vol / Liq)</dt>
            <dd className="font-mono-tabular font-medium text-[var(--ink)] mt-0.5">
              {instrument.volatility_regime} / {instrument.liquidity_regime}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--mut)]">Random seed</dt>
            <dd className="font-mono-tabular font-semibold text-[var(--ink)] mt-0.5">
              {runMetadata.random_seed}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--mut)]">Versions (cfg / gen / scn)</dt>
            <dd className="font-mono-tabular font-medium text-[var(--ink)] mt-0.5 truncate" title={`${runMetadata.config_version} / ${runMetadata.generator_version} / ${runMetadata.scenario_version}`}>
              {runMetadata.config_version} · {runMetadata.generator_version}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--mut)]">Bundle size budget</dt>
            <dd className="font-mono-tabular font-medium text-[var(--ink)] mt-0.5">
              {totalEmbeddedKb} KB / {runMetadata.bundle_budget_kb.max_budget_kb} KB
            </dd>
          </div>
        </dl>

        {/* Expandable config_json + size budget detail */}
        {showConfig && (
          <div className="mt-4 pt-4 border-t border-[var(--ln)] grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between text-xs text-[var(--mut)] mb-1.5">
                <span className="font-medium text-[var(--ink)]">
                  quality.run_metadata.config_json
                </span>
                <span className="font-mono-tabular">{runMetadata.config_hash}</span>
              </div>
              <pre className="font-mono-tabular text-xs bg-[var(--bg)] border border-[var(--ln)] rounded-lg p-3 overflow-x-auto text-[var(--ink)] leading-relaxed">
                {JSON.stringify(runMetadata.config_json, null, 2)}
              </pre>
            </div>
            <div className="space-y-3">
              <div className="text-xs font-medium text-[var(--ink)]">
                Single-file HTML payload budget &amp; windowing strategy
              </div>
              <p className="text-xs text-[var(--mut)] leading-relaxed">
                Full session contains{' '}
                <span className="font-mono-tabular text-[var(--ink)]">
                  {runMetadata.bundle_budget_kb.total_session_events.toLocaleString()}
                </span>{' '}
                raw events. To stay portable under{' '}
                <span className="font-mono-tabular text-[var(--ink)]">
                  {runMetadata.bundle_budget_kb.max_budget_kb} KB
                </span>
                , this bundle embeds full-resolution slices around scenario windows plus a{' '}
                <span className="font-mono-tabular text-[var(--ink)]">
                  {runMetadata.bundle_budget_kb.baseline_sample_pct}%
                </span>{' '}
                baseline sample (
                <span className="font-mono-tabular text-[var(--ink)]">
                  {runMetadata.bundle_budget_kb.embedded_events.toLocaleString()}
                </span>{' '}
                events).
              </p>
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-mono-tabular">
                  <span className="text-[var(--mut)]">
                    {isModelInputOnly
                      ? 'model_input payload only'
                      : `model_input (${runMetadata.bundle_budget_kb.model_input_kb} KB) + labels sidecar (${runMetadata.bundle_budget_kb.labels_sidecar_kb} KB)`}
                  </span>
                  <span className="text-[var(--ink)] font-medium">
                    {budgetPct.toFixed(1)}% of cap
                  </span>
                </div>
                <div className="h-2.5 rounded bg-[var(--ln)] overflow-hidden">
                  <div
                    className="h-full bg-[var(--sell)] transition-all duration-200"
                    style={{ width: `${budgetPct}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Label Isolation Mode & Answer Key Reveal Strip */}
      <section
        aria-label="Label isolation and reveal control"
        className="bg-[var(--sf)] border border-[var(--ln)] rounded-xl p-3.5 sm:px-4 flex flex-wrap items-center justify-between gap-4"
      >
        {/* Artifact Mode Switcher: model_input vs evaluator */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--ink)]">
            <ShieldCheck className="w-4 h-4 text-[var(--mut)]" />
            <span>Report artifact mode</span>
          </div>
          <div
            role="group"
            aria-label="Report artifact isolation mode"
            className="inline-flex p-1 bg-[var(--bg)] border border-[var(--ln)] rounded-lg gap-1"
          >
            <button
              type="button"
              onClick={() => onChangeArtifactMode('model_input')}
              aria-pressed={isModelInputOnly}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                isModelInputOnly
                  ? 'bg-[var(--ink)] text-[var(--bg)]'
                  : 'text-[var(--mut)] hover:text-[var(--ink)]'
              }`}
            >
              model_input.* (label-free)
            </button>
            <button
              type="button"
              onClick={() => onChangeArtifactMode('evaluator')}
              aria-pressed={!isModelInputOnly}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                !isModelInputOnly
                  ? 'bg-[var(--ink)] text-[var(--bg)]'
                  : 'text-[var(--mut)] hover:text-[var(--ink)]'
              }`}
            >
              evaluator (labels sidecar)
            </button>
          </div>
          <span className="text-xs text-[var(--mut)]">
            {isModelInputOnly
              ? 'PostgreSQL role model_reader · labels.* physically excluded from payload'
              : 'PostgreSQL role evaluator · labels.scenario_manifest sidecar loaded'}
          </span>
        </div>

        {/* Reveal Toggle (Disabled when in label-free model_input mode) */}
        <div className="flex items-center gap-3">
          {isModelInputOnly ? (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--ln)] bg-[var(--bg)] text-xs text-[var(--mut)]">
              <Lock className="w-3.5 h-3.5" />
              <span>Answer key unavailable in label-free build</span>
            </div>
          ) : (
            <label
              className={`inline-flex items-center gap-2.5 px-3.5 py-2 rounded-lg border border-dashed cursor-pointer select-none transition-colors ${
                revealLabels
                  ? 'border-[var(--flag)] bg-[var(--flag)]/10 text-[var(--ink)]'
                  : 'border-[var(--ln)] bg-[var(--bg)] text-[var(--ink)] hover:border-[var(--flag)]'
              }`}
            >
              <input
                type="checkbox"
                checked={revealLabels}
                onChange={(e) => onToggleReveal(e.target.checked)}
                className="w-4 h-4 accent-[var(--flag)] cursor-pointer"
              />
              {revealLabels ? (
                <Eye className="w-4 h-4 text-[var(--flag)]" />
              ) : (
                <EyeOff className="w-4 h-4 text-[var(--mut)]" />
              )}
              <span className="text-xs font-semibold whitespace-nowrap">
                Reveal answer key
              </span>
              <span className="text-xs text-[var(--mut)] hidden md:inline">
                {revealLabels ? 'Showing ground truth' : 'Blind detector view'}
              </span>
            </label>
          )}
        </div>
      </section>
    </div>
  );
};
