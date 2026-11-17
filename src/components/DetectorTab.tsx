import React, { useMemo, useState } from 'react';
import { ArrowUpRight, Lock } from 'lucide-react';
import {
  ReportArtifactMode,
  ScenarioManifestRow,
  ScoringStage,
  SurveillanceFeatureRow,
} from '../types/surveillance';
import { formatSessionClock } from '../data/syntheticRunGenerator';

interface DetectorTabProps {
  artifactMode: ReportArtifactMode;
  revealLabels: boolean;
  features: SurveillanceFeatureRow[];
  scenarios: ScenarioManifestRow[];
  onInspectInMarketView: (params: { scenarioId?: string; participantId?: string }) => void;
}

const FEATURE_META: Record<
  string,
  { label: string; unit: string; min: number; max: number; takeaway: string }
> = {
  opposite_side_cancel_ratio: {
    label: 'opposite_side_cancel_ratio',
    unit: 'ratio',
    min: 0,
    max: 1,
    takeaway:
      'At POST_EVENT, spoofing & layering cluster above 0.75, while coincidental opposite-trade hard negatives spread across 0.45–0.82.',
  },
  cancel_to_fill_latency_ms: {
    label: 'cancel_to_fill_latency_ms',
    unit: 'ms',
    min: 0,
    max: 4000,
    takeaway:
      'Positives cancel within 220–750ms after opposite fills; legitimate MM requotes overlap tightly in the <1,000ms bucket.',
  },
  order_book_imbalance_delta: {
    label: 'order_book_imbalance_delta',
    unit: 'delta',
    min: 0,
    max: 1,
    takeaway:
      'IN_LIFECYCLE captures book skew induced by passive stacking before any fill occurs.',
  },
  multi_level_layer_depth: {
    label: 'multi_level_layer_depth',
    unit: 'levels',
    min: 0,
    max: 8,
    takeaway:
      'Separates LAYERING_PATTERN (5–7 levels) from single-order spoofs, though LEGITIMATE_MULTI_LEVEL_QUOTING overlaps at 4–5 levels.',
  },
  order_size_vs_adv_pct: {
    label: 'order_size_vs_adv_pct',
    unit: '%',
    min: 0,
    max: 100,
    takeaway:
      'Available at SUBMISSION; catches LARGE_ORDER_ONLY and institutional blocks equally, causing high false-positive rates if used alone.',
  },
};

const STAGES: ScoringStage[] = ['SUBMISSION', 'IN_LIFECYCLE', 'POST_EVENT'];

export const DetectorTab: React.FC<DetectorTabProps> = ({
  artifactMode,
  revealLabels,
  features,
  scenarios,
  onInspectInMarketView,
}) => {
  const [stage, setStage] = useState<ScoringStage>('POST_EVENT');
  const [featureVersion, setFeatureVersion] = useState<string>('v2.1.0');
  const [featureName, setFeatureName] = useState<string>('opposite_side_cancel_ratio');

  const canReveal = artifactMode === 'evaluator' && revealLabels;
  const isModelInputOnly = artifactMode === 'model_input';

  const scenarioById = useMemo(() => {
    const map = new Map<string, ScenarioManifestRow>();
    if (!isModelInputOnly) {
      for (const s of scenarios) map.set(s.scenario_id, s);
    }
    return map;
  }, [scenarios, isModelInputOnly]);

  // Stage-level metrics across all 3 scoring stages for active feature_version
  const stageMetrics = useMemo(() => {
    return STAGES.map((st) => {
      // Group rows by (entity_type, entity_id) using opposite_side_cancel_ratio as representative entity row
      const entityRows = features.filter(
        (f) =>
          f.feature_version === featureVersion &&
          f.scoring_stage === st &&
          f.feature_name === 'opposite_side_cancel_ratio'
      );

      const alerts = entityRows.filter((r) => r.context.alert_triggered);
      const degraded = entityRows.filter((r) => r.data_quality_status !== 'OK').length;

      let tp = 0;
      let fpHardNeg = 0;
      let fpBase = 0;
      let totalPos = 0;

      if (canReveal) {
        for (const r of entityRows) {
          const scn = r.entity_type === 'SCENARIO' ? scenarioById.get(r.entity_id) : undefined;
          if (scn?.evaluation_label === 'POSITIVE_TEST') totalPos++;
          if (r.context.alert_triggered) {
            if (scn?.evaluation_label === 'POSITIVE_TEST') tp++;
            else if (scn?.evaluation_label === 'NEGATIVE_CONTROL') fpHardNeg++;
            else fpBase++;
          }
        }
      }

      const fp = fpHardNeg + fpBase;
      const fn = totalPos - tp;
      const prec = tp + fp > 0 ? (tp / (tp + fp)) * 100 : 0;
      const rec = totalPos > 0 ? (tp / totalPos) * 100 : 0;

      return {
        stage: st,
        entityCount: entityRows.length,
        alertCount: alerts.length,
        degraded,
        tp,
        fpHardNeg,
        fpBase,
        fn,
        totalPos,
        prec,
        rec,
      };
    });
  }, [features, featureVersion, canReveal, scenarioById]);

  // Feature Distribution Bins for selected (featureVersion, stage, featureName)
  const distBins = useMemo(() => {
    const meta = FEATURE_META[featureName];
    const bins = 8;
    const step = (meta.max - meta.min) / bins;

    const counts = Array.from({ length: bins }, (_, i) => ({
      label:
        meta.max >= 100
          ? `${Math.round(meta.min + i * step)}`
          : (meta.min + i * step).toFixed(2),
      all: 0,
      base: 0,
      hardNeg: 0,
      pos: 0,
    }));

    const matching = features.filter(
      (f) =>
        f.feature_version === featureVersion &&
        f.scoring_stage === stage &&
        f.feature_name === featureName &&
        f.feature_value_num !== null
    );

    for (const row of matching) {
      const val = row.feature_value_num ?? 0;
      const idx = Math.min(
        bins - 1,
        Math.max(0, Math.floor((val - meta.min) / Math.max(1e-6, step)))
      );
      counts[idx].all++;
      if (canReveal) {
        const scn = row.entity_type === 'SCENARIO' ? scenarioById.get(row.entity_id) : undefined;
        if (scn?.evaluation_label === 'POSITIVE_TEST') counts[idx].pos++;
        else if (scn?.evaluation_label === 'NEGATIVE_CONTROL') counts[idx].hardNeg++;
        else counts[idx].base++;
      }
    }

    const sumAll = counts.reduce((s, c) => s + c.all, 0) || 1;
    const sumBase = counts.reduce((s, c) => s + c.base, 0) || 1;
    const sumHard = counts.reduce((s, c) => s + c.hardNeg, 0) || 1;
    const sumPos = counts.reduce((s, c) => s + c.pos, 0) || 1;

    return counts.map((c) => ({
      label: c.label,
      allPct: (c.all / sumAll) * 100,
      basePct: (c.base / sumBase) * 100,
      hardNegPct: (c.hardNeg / sumHard) * 100,
      posPct: (c.pos / sumPos) * 100,
    }));
  }, [features, featureVersion, stage, featureName, canReveal, scenarioById]);

  // Build Alert / Scored Entity Table for active (featureVersion, stage)
  const alertRows = useMemo(() => {
    const byEntity = new Map<
      string,
      {
        entity_type: SurveillanceFeatureRow['entity_type'];
        entity_id: string;
        timestamp_sec: number;
        dq_status: SurveillanceFeatureRow['data_quality_status'];
        context: SurveillanceFeatureRow['context'];
        values: Record<string, number>;
      }
    >();

    for (const f of features) {
      if (f.feature_version !== featureVersion || f.scoring_stage !== stage) continue;
      const key = `${f.entity_type}:${f.entity_id}`;
      let rec = byEntity.get(key);
      if (!rec) {
        rec = {
          entity_type: f.entity_type,
          entity_id: f.entity_id,
          timestamp_sec: f.feature_timestamp_sec,
          dq_status: f.data_quality_status,
          context: f.context,
          values: {},
        };
        byEntity.set(key, rec);
      }
      if (f.feature_value_num !== null) rec.values[f.feature_name] = f.feature_value_num;
    }

    return Array.from(byEntity.values())
      .filter((r) => r.context.alert_triggered || (canReveal && r.entity_type === 'SCENARIO'))
      .sort((a, b) => (b.context.composite_score ?? 0) - (a.context.composite_score ?? 0))
      .slice(0, 18);
  }, [features, featureVersion, stage, canReveal]);

  const meta = FEATURE_META[featureName];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-[var(--ink)]">
          Surveillance features &amp; multi-stage detector results
        </h2>
        <p className="text-xs text-[var(--mut)] mt-0.5 max-w-3xl">
          Reads long-format <span className="font-mono-tabular">analytics.surveillance_features</span>{' '}
          keyed by <span className="font-mono-tabular">(entity_type, entity_id, feature_version, scoring_stage)</span>.
          Inspect feature class separation and stage-by-stage alert verdicts.
        </p>
      </div>

      {/* Stage & Feature Selectors */}
      <div className="flex flex-wrap items-end justify-between gap-4 bg-[var(--bg)] border border-[var(--ln)] rounded-xl p-3">
        <div>
          <div className="text-xs font-medium text-[var(--mut)] mb-1">scoring_stage</div>
          <div
            role="group"
            aria-label="Select scoring stage"
            className="inline-flex p-1 bg-[var(--sf)] border border-[var(--ln)] rounded-lg gap-1"
          >
            {STAGES.map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStage(st)}
                aria-pressed={stage === st}
                className={`px-3 py-1.5 text-xs font-mono-tabular font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  stage === st
                    ? 'bg-[var(--ink)] text-[var(--bg)]'
                    : 'text-[var(--mut)] hover:text-[var(--ink)]'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="block text-xs font-medium text-[var(--mut)] mb-1">
              feature_version
            </span>
            <select
              value={featureVersion}
              onChange={(e) => setFeatureVersion(e.target.value)}
              className="text-xs font-mono-tabular bg-[var(--sf)] text-[var(--ink)] border border-[var(--ln)] rounded-lg px-2.5 py-2 cursor-pointer"
            >
              <option value="v2.1.0">v2.1.0 (current)</option>
              <option value="v2.0.0">v2.0.0 (baseline)</option>
            </select>
          </label>

          <label className="block min-w-[230px]">
            <span className="block text-xs font-medium text-[var(--mut)] mb-1">
              feature_name
            </span>
            <select
              value={featureName}
              onChange={(e) => setFeatureName(e.target.value)}
              className="w-full text-xs font-mono-tabular bg-[var(--sf)] text-[var(--ink)] border border-[var(--ln)] rounded-lg px-2.5 py-2 cursor-pointer"
            >
              {Object.keys(FEATURE_META).map((fn) => (
                <option key={fn} value={fn}>
                  {fn}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* Results per Scoring Stage Comparison */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {stageMetrics.map((m) => {
          const isActive = m.stage === stage;
          return (
            <button
              key={m.stage}
              type="button"
              onClick={() => setStage(m.stage)}
              className={`text-left rounded-xl border p-4 transition-colors cursor-pointer ${
                isActive
                  ? 'border-[var(--ink)] bg-[var(--sf-alt)]'
                  : 'border-[var(--ln)] bg-[var(--bg)] hover:border-[var(--mut)]'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono-tabular text-xs font-bold text-[var(--ink)]">
                  {m.stage}
                </span>
                <span className="font-mono-tabular text-xs text-[var(--mut)]">
                  {m.alertCount} alerts / {m.entityCount} entities
                </span>
              </div>

              {canReveal ? (
                <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-[var(--ln)] font-mono-tabular">
                  <div>
                    <div className="text-[11px] text-[var(--mut)]">Precision</div>
                    <div className="text-base font-bold text-[var(--ink)]">
                      {m.prec.toFixed(0)}%
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-[var(--mut)]">Recall</div>
                    <div className="text-base font-bold text-[var(--ink)]">
                      {m.rec.toFixed(0)}%
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-[var(--mut)]">Caught</div>
                    <div className="text-base font-bold text-[var(--flag)]">
                      {m.tp}/{m.totalPos}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-3 pt-3 border-t border-[var(--ln)] flex items-center gap-1.5 text-xs text-[var(--mut)]">
                  <Lock className="w-3.5 h-3.5" />
                  <span>
                    {isModelInputOnly
                      ? 'Precision/Recall withheld (model_input)'
                      : 'Reveal answer key to score stage'}
                  </span>
                </div>
              )}

              {m.degraded > 0 && (
                <div className="mt-2 font-mono-tabular text-[11px] text-[var(--fail)]">
                  {m.degraded} entity skipped (data_quality_status = DEGRADED)
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Feature Distribution by Class */}
      <div className="space-y-2 pt-2 border-t border-[var(--ln)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-[var(--ink)]">
            Feature distribution:{' '}
            <span className="font-mono-tabular">{featureName}</span> at{' '}
            <span className="font-mono-tabular">{stage}</span> ({featureVersion})
          </h3>
          {canReveal ? (
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
          ) : (
            <span className="text-xs text-[var(--mut)]">
              Combined unlabeled distribution (ground truth withheld)
            </span>
          )}
        </div>

        <svg
          viewBox="0 0 900 185"
          className="w-full h-auto block"
          role="img"
          aria-label={`Feature distribution for ${featureName}`}
        >
          {[0, 30, 60].map((pct) => {
            const y = 148 - (pct / 75) * 126;
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

          {distBins.map((b, idx) => {
            const bw = 840 / distBins.length;
            const x0 = 48 + idx * bw + 8;

            if (!canReveal) {
              const hAll = Math.min(130, (b.allPct / 75) * 126);
              return (
                <g key={b.label + idx}>
                  <rect
                    x={x0 + 18}
                    y={148 - hAll}
                    width="48"
                    height={hAll}
                    rx="3"
                    fill="var(--sell)"
                    fillOpacity="0.65"
                  />
                  <text
                    x={x0 + 42}
                    y="168"
                    textAnchor="middle"
                    fill="var(--mut)"
                    fontSize="10.5"
                    fontFamily="IBM Plex Mono, monospace"
                  >
                    ≥{b.label}
                  </text>
                </g>
              );
            }

            const hBase = Math.min(130, (b.basePct / 75) * 126);
            const hHard = Math.min(130, (b.hardNegPct / 75) * 126);
            const hPos = Math.min(130, (b.posPct / 75) * 126);

            return (
              <g key={b.label + idx}>
                <rect
                  x={x0}
                  y={148 - hBase}
                  width="22"
                  height={hBase}
                  rx="2.5"
                  fill="var(--sell)"
                  fillOpacity="0.5"
                />
                <rect
                  x={x0 + 25}
                  y={148 - hHard}
                  width="22"
                  height={hHard}
                  rx="2.5"
                  fill="var(--look)"
                />
                <rect
                  x={x0 + 50}
                  y={148 - hPos}
                  width="22"
                  height={hPos}
                  rx="2.5"
                  fill="var(--flag)"
                />
                <text
                  x={x0 + 36}
                  y="168"
                  textAnchor="middle"
                  fill="var(--mut)"
                  fontSize="10.5"
                  fontFamily="IBM Plex Mono, monospace"
                >
                  ≥{b.label}
                </text>
              </g>
            );
          })}
        </svg>
        <p className="text-xs text-[var(--mut)]">Takeaway: {meta.takeaway}</p>
      </div>

      {/* Scored Entity / Alert Table with Verdict Column */}
      <div className="space-y-2 pt-2 border-t border-[var(--ln)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-[var(--ink)]">
            Scored entities &amp; alerts ({stage} · {featureVersion})
          </h3>
          <span className="text-xs text-[var(--mut)]">
            Click Inspect to jump directly to the window in Market view
          </span>
        </div>

        <div className="overflow-x-auto border border-[var(--ln)] rounded-xl">
          <table className="w-full border-collapse text-xs font-mono-tabular min-w-[780px]">
            <thead>
              <tr className="bg-[var(--bg)] border-b border-[var(--ln)] text-[var(--mut)]">
                <th className="text-left px-3 py-2 font-medium">feature_ts</th>
                <th className="text-left px-3 py-2 font-medium">entity</th>
                <th className="text-left px-3 py-2 font-medium">participant</th>
                <th className="text-right px-3 py-2 font-medium">{featureName}</th>
                <th className="text-right px-3 py-2 font-medium">composite_score</th>
                <th className="text-left px-3 py-2 font-medium">dq_status</th>
                <th className="text-left px-3 py-2 font-medium">verdict vs answer key</th>
                <th className="text-right px-3 py-2 font-medium">view</th>
              </tr>
            </thead>
            <tbody>
              {alertRows.map((row) => {
                const scn =
                  canReveal && row.entity_type === 'SCENARIO'
                    ? scenarioById.get(row.entity_id)
                    : undefined;
                const triggered = Boolean(row.context.alert_triggered);

                let verdictText = 'Withheld';
                let verdictClass = 'text-[var(--mut)]';
                let rowTint = '';

                if (canReveal) {
                  if (scn?.evaluation_label === 'POSITIVE_TEST') {
                    if (triggered) {
                      verdictText = `TP · ${scn.ground_truth_label}`;
                      verdictClass = 'text-[var(--flag)] font-semibold';
                    } else {
                      verdictText = `FN (missed) · ${scn.ground_truth_label}`;
                      verdictClass = 'text-[var(--fail)] font-semibold';
                    }
                    rowTint = 'bg-[var(--flag)]/10';
                  } else if (scn?.evaluation_label === 'NEGATIVE_CONTROL') {
                    verdictText = triggered
                      ? `FP (hard neg) · ${scn.ground_truth_label}`
                      : `TN (cleared) · ${scn.ground_truth_label}`;
                    verdictClass = 'text-[var(--look)] font-semibold';
                    rowTint = 'bg-[var(--look)]/12';
                  } else {
                    verdictText = 'FP · Baseline flow';
                    verdictClass = 'text-[var(--mut)]';
                  }
                } else {
                  verdictText = isModelInputOnly
                    ? 'Excluded (model_input.*)'
                    : 'Hidden (reveal answer key)';
                }

                // In model_input mode, hide scenario entity_ids to prevent leakage
                const displayEntityId =
                  isModelInputOnly && row.entity_type === 'SCENARIO'
                    ? `ENT-${row.context.participant_id ?? 'ANON'}`
                    : `${row.entity_type}:${row.entity_id}`;

                return (
                  <tr
                    key={`${row.entity_type}-${row.entity_id}`}
                    className={`border-b border-[var(--ln)]/60 hover:bg-[var(--sf-alt)] ${rowTint}`}
                  >
                    <td className="px-3 py-2">{formatSessionClock(row.timestamp_sec).slice(0, 8)}</td>
                    <td className="px-3 py-2 font-semibold">{displayEntityId}</td>
                    <td className="px-3 py-2">{row.context.participant_id ?? '—'}</td>
                    <td className="px-3 py-2 text-right">
                      {row.values[featureName] !== undefined
                        ? row.values[featureName].toFixed(featureName.includes('ms') ? 0 : 2)
                        : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold">
                      {(row.context.composite_score ?? 0).toFixed(3)}
                      {triggered ? ' *' : ''}
                    </td>
                    <td
                      className={`px-3 py-2 ${
                        row.dq_status === 'OK' ? 'text-[var(--pass)]' : 'text-[var(--fail)] font-semibold'
                      }`}
                    >
                      {row.dq_status}
                    </td>
                    <td className={`px-3 py-2 font-sans ${verdictClass}`}>{verdictText}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          onInspectInMarketView({
                            scenarioId:
                              canReveal && row.entity_type === 'SCENARIO'
                                ? row.entity_id
                                : undefined,
                            participantId: row.context.participant_id,
                          })
                        }
                        className="inline-flex items-center gap-1 text-xs font-sans font-medium text-[var(--sell)] hover:underline cursor-pointer"
                      >
                        <span>Inspect</span>
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
