import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Lock,
  XCircle,
} from 'lucide-react';
import {
  ReportArtifactMode,
  ValidationResultRow,
  ValidationStatus,
} from '../types/surveillance';

interface DataQualityTabProps {
  artifactMode: ReportArtifactMode;
  revealLabels: boolean;
  validationResults: ValidationResultRow[];
  seededPassing: { passed: number; total: number };
}

const SCOPES: ValidationResultRow['scope'][] = [
  'RUN',
  'INSTRUMENT',
  'EVENT_STREAM',
  'ORDER_STATE',
  'BOOK_SNAPSHOTS',
  'SCENARIO_MANIFEST',
];

export const DataQualityTab: React.FC<DataQualityTabProps> = ({
  artifactMode,
  revealLabels,
  validationResults,
  seededPassing,
}) => {
  const [selectedScope, setSelectedScope] = useState<'ALL' | ValidationResultRow['scope']>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | ValidationStatus>('ALL');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const canReveal = artifactMode === 'evaluator' && revealLabels;
  const isModelInputOnly = artifactMode === 'model_input';

  // In model_input mode, hide SCENARIO_MANIFEST validation details that reference specific scenario_ids
  const visibleRows = useMemo(() => {
    return validationResults.filter((r) => {
      if (isModelInputOnly && r.scenario_id !== null) return false;
      if (selectedScope !== 'ALL' && r.scope !== selectedScope) return false;
      if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
      return true;
    });
  }, [validationResults, isModelInputOnly, selectedScope, statusFilter]);

  const scopeScorecards = useMemo(() => {
    return SCOPES.map((sc) => {
      const rows = validationResults.filter(
        (r) => r.scope === sc && !(isModelInputOnly && r.scenario_id !== null)
      );
      const pass = rows.filter((r) => r.status === 'PASS').length;
      const fail = rows.filter((r) => r.status === 'FAIL').length;
      const pending = rows.filter((r) => r.status === 'PENDING').length;
      const overall: ValidationStatus =
        fail > 0 ? 'FAIL' : pending > 0 ? 'PENDING' : 'PASS';
      return { scope: sc, total: rows.length, pass, fail, pending, overall };
    });
  }, [validationResults, isModelInputOnly]);

  const renderStatusLabel = (st: ValidationStatus) => {
    if (st === 'PASS') {
      return (
        <span className="inline-flex items-center gap-1 text-[var(--pass)] font-semibold font-mono-tabular">
          <CheckCircle2 className="w-3.5 h-3.5" />
          PASS
        </span>
      );
    }
    if (st === 'FAIL') {
      return (
        <span className="inline-flex items-center gap-1 text-[var(--fail)] font-semibold font-mono-tabular">
          <XCircle className="w-3.5 h-3.5" />
          FAIL
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-[var(--pend)] font-semibold font-mono-tabular">
        <Clock className="w-3.5 h-3.5" />
        PENDING
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-[var(--ink)]">
          Validation gate &amp; quality.validation_results
        </h2>
        <p className="text-xs text-[var(--mut)] mt-0.5 max-w-3xl">
          Validation runs as a hard release gate across six scopes. Pass/fail semantics use green
          and crimson independently of buy/sell colours. Click any scope scorecard to filter the
          ledger.
        </p>
      </div>

      {/* Scorecard Tiles by Scope */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {scopeScorecards.map((card) => {
          const isSel = selectedScope === card.scope;
          return (
            <button
              key={card.scope}
              type="button"
              onClick={() =>
                setSelectedScope((prev) => (prev === card.scope ? 'ALL' : card.scope))
              }
              className={`text-left rounded-xl border p-3 transition-colors cursor-pointer ${
                isSel
                  ? 'border-[var(--ink)] bg-[var(--sf-alt)]'
                  : 'border-[var(--ln)] bg-[var(--bg)] hover:border-[var(--mut)]'
              }`}
            >
              <div className="font-mono-tabular text-[11px] font-semibold text-[var(--mut)] truncate">
                {card.scope}
              </div>
              <div className="mt-1.5 text-xs">{renderStatusLabel(card.overall)}</div>
              <div className="mt-1.5 font-mono-tabular text-[11px] text-[var(--mut)]">
                {card.pass}/{card.total} pass
                {card.fail > 0 ? ` · ${card.fail} fail` : ''}
                {card.pending > 0 ? ` · ${card.pending} pend` : ''}
              </div>
            </button>
          );
        })}
      </div>

      {/* Spoof Lab Carried-Over Per-Check Pass Rate Bars */}
      <div className="space-y-2.5 pt-2 border-t border-[var(--ln)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-[var(--ink)]">
            Per-check pass rates ({visibleRows.length} checks shown)
          </h3>
          <div className="flex items-center gap-2">
            {selectedScope !== 'ALL' && (
              <button
                type="button"
                onClick={() => setSelectedScope('ALL')}
                className="text-xs px-2.5 py-1 rounded-lg border border-[var(--ln)] bg-[var(--bg)] text-[var(--ink)] cursor-pointer"
              >
                Scope: {selectedScope} ×
              </button>
            )}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'ALL' | ValidationStatus)}
              aria-label="Filter checks by validation status"
              className="text-xs font-mono-tabular bg-[var(--bg)] text-[var(--ink)] border border-[var(--ln)] rounded-lg px-2.5 py-1.5 cursor-pointer"
            >
              <option value="ALL">All statuses</option>
              <option value="PASS">PASS only</option>
              <option value="FAIL">FAIL only</option>
              <option value="PENDING">PENDING only</option>
            </select>
          </div>
        </div>

        <div className="space-y-2.5">
          {visibleRows.map((row) => {
            const barColor =
              row.status === 'FAIL'
                ? 'var(--fail)'
                : row.status === 'PENDING'
                  ? 'var(--pend)'
                  : 'var(--pass)';
            return (
              <div
                key={row.result_id}
                className="grid grid-cols-1 sm:grid-cols-[230px_1fr_72px] gap-2 sm:gap-4 items-center"
              >
                <div>
                  <div className="font-mono-tabular text-xs font-semibold text-[var(--ink)]">
                    {row.check_id}{' '}
                    <span className="text-[var(--mut)] font-normal">
                      · {row.requirement_id ?? '—'}
                    </span>
                  </div>
                  <div className="text-[11px] text-[var(--mut)] truncate" title={row.message ?? ''}>
                    {row.scope} · {row.passed_rows.toLocaleString()}/{row.checked_rows.toLocaleString()} rows
                  </div>
                </div>

                <div className="h-2.5 rounded bg-[var(--ln)] overflow-hidden">
                  <div
                    className="h-full transition-all duration-200"
                    style={{
                      width: `${Math.max(2, row.pass_rate_pct)}%`,
                      backgroundColor: barColor,
                    }}
                  />
                </div>

                <div className="font-mono-tabular text-xs font-semibold text-right text-[var(--ink)]">
                  {row.pass_rate_pct.toFixed(1)}%
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Clean is not the same as innocent Callout (hairline border, no border-l-4 cliché) */}
      <div className="bg-[var(--bg)] border border-[var(--ln)] rounded-xl p-4 text-xs leading-relaxed">
        {isModelInputOnly ? (
          <div className="flex items-center gap-2 text-[var(--mut)]">
            <Lock className="w-4 h-4 shrink-0" />
            <span>
              Seeded-order quality breakdown is withheld in{' '}
              <span className="font-mono-tabular">model_input.*</span> mode because scenario labels
              are excluded from this bundle.
            </span>
          </div>
        ) : (
          <div>
            <span className="font-bold text-[var(--flag)]">
              Clean is not the same as innocent.{' '}
            </span>
            <span className="text-[var(--ink)]">
              {canReveal
                ? `${seededPassing.passed} of ${seededPassing.total} POSITIVE_TEST scenario orders pass every structural and data-quality check.`
                : `${seededPassing.total} seeded positive orders exist in the held-out labels bundle; reveal the answer key to compare quality pass rates against behavioural labels.`}{' '}
              Quality validation verifies schema invariants and feed integrity; only behavioural
              features in <span className="font-mono-tabular">analytics.surveillance_features</span>{' '}
              distinguish participant intent.
            </span>
          </div>
        )}
      </div>

      {/* Machine-readable quality.validation_results Ledger */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-[var(--ink)]">
          Machine-readable validation ledger (quality.validation_results)
        </h3>
        <div className="overflow-x-auto border border-[var(--ln)] rounded-xl">
          <table className="w-full border-collapse text-xs font-mono-tabular min-w-[720px]">
            <thead>
              <tr className="bg-[var(--bg)] border-b border-[var(--ln)] text-[var(--mut)]">
                <th className="text-left px-3 py-2 font-medium">result_id</th>
                <th className="text-left px-3 py-2 font-medium">check_id</th>
                <th className="text-left px-3 py-2 font-medium">requirement</th>
                <th className="text-left px-3 py-2 font-medium">scope</th>
                <th className="text-left px-3 py-2 font-medium">status</th>
                <th className="text-left px-3 py-2 font-medium">message</th>
                <th className="text-right px-3 py-2 font-medium">details</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <React.Fragment key={row.result_id}>
                  <tr className="border-b border-[var(--ln)]/60 hover:bg-[var(--sf-alt)]">
                    <td className="px-3 py-2 text-[var(--mut)]">#{row.result_id}</td>
                    <td className="px-3 py-2 font-semibold">{row.check_id}</td>
                    <td className="px-3 py-2 text-[var(--mut)]">{row.requirement_id ?? '—'}</td>
                    <td className="px-3 py-2">{row.scope}</td>
                    <td className="px-3 py-2">{renderStatusLabel(row.status)}</td>
                    <td className="px-3 py-2 font-sans text-[var(--ink)]">
                      {row.message}
                      {canReveal && row.scenario_id && (
                        <span className="font-mono-tabular text-[var(--flag)] ml-2">
                          [{row.scenario_id}]
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {row.details && (
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedId((id) => (id === row.result_id ? null : row.result_id))
                          }
                          className="text-xs underline text-[var(--sell)] cursor-pointer"
                        >
                          {expandedId === row.result_id ? 'hide' : 'json'}
                        </button>
                      )}
                    </td>
                  </tr>
                  {expandedId === row.result_id && row.details && (
                    <tr className="bg-[var(--bg)] border-b border-[var(--ln)]">
                      <td colSpan={7} className="px-3 py-2">
                        <pre className="text-[11px] text-[var(--ink)] overflow-x-auto">
                          {JSON.stringify(row.details, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
