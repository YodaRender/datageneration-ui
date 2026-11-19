import React, { useState } from 'react';
import { Lock } from 'lucide-react';
import {
  SCHEMA_EDGES,
  SCHEMA_TABLES,
} from '../data/schemaCatalog';
import {
  ReportArtifactMode,
  SchemaLayerName,
  SchemaTableDef,
} from '../types/surveillance';

interface SchemaExplorerTabProps {
  artifactMode: ReportArtifactMode;
}

const LAYER_META: Array<{
  key: SchemaLayerName;
  title: string;
  subtitle: string;
  x: number;
  width: number;
}> = [
  { key: 'quality', title: 'quality', subtitle: 'run metadata & gate checks', x: 14, width: 204 },
  { key: 'core', title: 'core', subtitle: 'immutable events & derived state', x: 244, width: 214 },
  { key: 'analytics', title: 'analytics', subtitle: 'long-format features', x: 484, width: 210 },
  { key: 'labels', title: 'labels (isolated)', subtitle: 'ground truth · evaluator only', x: 484, width: 210 },
  { key: 'model_input', title: 'model_input (views)', subtitle: 'label-free · model_reader', x: 720, width: 216 },
];

export const SchemaExplorerTab: React.FC<SchemaExplorerTabProps> = ({ artifactMode }) => {
  const [selectedId, setSelectedId] = useState<string>('core.order_events');

  const selectedTable: SchemaTableDef =
    SCHEMA_TABLES.find((t) => t.id === selectedId) ?? SCHEMA_TABLES[0];

  const boxWidth = 192;
  const boxHeight = 64;

  const getCenter = (t: SchemaTableDef) => ({
    cx: t.x + boxWidth / 2,
    cy: t.y + boxHeight / 2,
    left: t.x,
    right: t.x + boxWidth,
    top: t.y,
    bottom: t.y + boxHeight,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-[var(--ink)]">
            Five-schema architecture &amp; information_schema lineage
          </h2>
          <p className="text-xs text-[var(--mut)] mt-0.5 max-w-3xl">
            Select any table or view to inspect columns, constraints, deferrable foreign keys, and
            columns stripped by <span className="font-mono-tabular">model_input.*</span> views.
          </p>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-[var(--mut)]">
        <span className="inline-flex items-center gap-2">
          <svg width="26" height="8" aria-hidden="true">
            <line x1="0" y1="4" x2="26" y2="4" stroke="var(--mut)" strokeWidth="1.5" />
          </svg>
          Standard FK
        </span>
        <span className="inline-flex items-center gap-2">
          <svg width="26" height="8" aria-hidden="true">
            <line
              x1="0"
              y1="4"
              x2="26"
              y2="4"
              stroke="var(--sell)"
              strokeWidth="1.75"
              strokeDasharray="3 3"
            />
          </svg>
          DEFERRABLE INITIALLY DEFERRED FK
        </span>
        <span className="inline-flex items-center gap-2">
          <svg width="26" height="8" aria-hidden="true">
            <line
              x1="0"
              y1="4"
              x2="26"
              y2="4"
              stroke="var(--flag)"
              strokeWidth="1.5"
              strokeDasharray="5 3"
            />
          </svg>
          REQ-OPS07 omitted FK (no join to labels)
        </span>
        <span className="inline-flex items-center gap-2">
          <svg width="26" height="8" aria-hidden="true">
            <line x1="0" y1="4" x2="26" y2="4" stroke="var(--buy)" strokeWidth="1.5" />
          </svg>
          Label-free VIEW projection
        </span>
      </div>

      {/* Interactive SVG 5-schema diagram */}
      <div className="bg-[var(--bg)] border border-[var(--ln)] rounded-xl p-3 overflow-x-auto">
        <svg
          viewBox="0 0 950 580"
          className="w-full min-w-[780px] h-auto select-none"
          role="img"
          aria-label="Five-schema database architecture diagram"
        >
          {/* Schema swimlane backgrounds */}
          <rect
            x="14"
            y="8"
            width="212"
            height="560"
            rx="10"
            fill="var(--sf)"
            fillOpacity="0.55"
            stroke="var(--ln)"
          />
          <text x="26" y="28" fill="var(--ink)" fontSize="12" fontWeight="700">
            quality
          </text>
          <text x="76" y="28" fill="var(--mut)" fontSize="11">
            metadata &amp; gate
          </text>

          <rect
            x="244"
            y="8"
            width="220"
            height="560"
            rx="10"
            fill="var(--sf)"
            fillOpacity="0.55"
            stroke="var(--ln)"
          />
          <text x="256" y="26" fill="var(--ink)" fontSize="12" fontWeight="700">
            core
          </text>
          <text x="288" y="26" fill="var(--mut)" fontSize="11">
            immutable events &amp; state
          </text>

          <rect
            x="482"
            y="8"
            width="220"
            height="270"
            rx="10"
            fill="var(--sf)"
            fillOpacity="0.55"
            stroke="var(--ln)"
          />
          <text x="494" y="28" fill="var(--ink)" fontSize="12" fontWeight="700">
            analytics
          </text>
          <text x="556" y="28" fill="var(--mut)" fontSize="11">
            long-format features
          </text>

          {/* labels schema with carried-over dashed magenta border */}
          <rect
            x="482"
            y="296"
            width="220"
            height="272"
            rx="10"
            fill="var(--sf)"
            fillOpacity="0.55"
            stroke="var(--flag)"
            strokeWidth="1.5"
            strokeDasharray="6 4"
          />
          <text x="494" y="318" fill="var(--flag)" fontSize="12" fontWeight="700">
            labels (held out)
          </text>
          <text x="598" y="318" fill="var(--mut)" fontSize="11">
            evaluator only
          </text>

          <rect
            x="720"
            y="8"
            width="216"
            height="560"
            rx="10"
            fill="var(--sf)"
            fillOpacity="0.55"
            stroke="var(--buy)"
            strokeOpacity="0.55"
          />
          <text x="732" y="28" fill="var(--buy)" fontSize="12" fontWeight="700">
            model_input
          </text>
          <text x="814" y="28" fill="var(--mut)" fontSize="11">
            label-free views
          </text>

          {/* Relationship Edges */}
          {SCHEMA_EDGES.map((edge, idx) => {
            const fromT = SCHEMA_TABLES.find((t) => t.id === edge.from);
            const toT = SCHEMA_TABLES.find((t) => t.id === edge.to);
            if (!fromT || !toT) return null;
            const f = getCenter(fromT);
            const t = getCenter(toT);

            let x1 = f.cx;
            let y1 = f.cy;
            let x2 = t.cx;
            let y2 = t.cy;

            if (fromT.x < toT.x) {
              x1 = f.right;
              x2 = t.left;
            } else if (fromT.x > toT.x) {
              x1 = f.left;
              x2 = t.right;
            } else if (fromT.y > toT.y) {
              y1 = f.top;
              y2 = t.bottom;
            } else {
              y1 = f.bottom;
              y2 = t.top;
            }

            const stroke =
              edge.kind === 'DEFERRABLE_FK'
                ? 'var(--sell)'
                : edge.kind === 'OMITTED_FK'
                  ? 'var(--flag)'
                  : edge.kind === 'VIEW_SOURCE'
                    ? 'var(--buy)'
                    : 'var(--mut)';

            const dash =
              edge.kind === 'DEFERRABLE_FK'
                ? '3 3'
                : edge.kind === 'OMITTED_FK'
                  ? '5 3'
                  : undefined;

            const midX = (x1 + x2) / 2;
            const midY = (y1 + y2) / 2;

            return (
              <g key={`${edge.from}-${edge.to}-${idx}`}>
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={stroke}
                  strokeWidth={edge.kind === 'DEFERRABLE_FK' ? 1.8 : 1.3}
                  strokeDasharray={dash}
                  strokeOpacity={edge.kind === 'OMITTED_FK' ? 0.85 : 0.65}
                />
                {edge.kind === 'OMITTED_FK' && (
                  <g>
                    <rect
                      x={midX - 54}
                      y={midY - 9}
                      width="108"
                      height="18"
                      rx="4"
                      fill="var(--sf)"
                      stroke="var(--flag)"
                      strokeWidth="1"
                    />
                    <text
                      x={midX}
                      y={midY + 3}
                      textAnchor="middle"
                      fill="var(--flag)"
                      fontSize="9.5"
                      fontFamily="IBM Plex Mono, monospace"
                      fontWeight="600"
                    >
                      REQ-OPS07: No FK
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Table / View Nodes */}
          {SCHEMA_TABLES.map((tbl) => {
            const isSel = tbl.id === selectedId;
            const isLabels = tbl.schema === 'labels';
            const isView = tbl.table_type === 'VIEW';
            const strokeColor = isSel
              ? 'var(--ink)'
              : isLabels
                ? 'var(--flag)'
                : isView
                  ? 'var(--buy)'
                  : 'var(--ln)';

            return (
              <g
                key={tbl.id}
                role="button"
                tabIndex={0}
                aria-label={`Inspect ${tbl.id}`}
                onClick={() => setSelectedId(tbl.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelectedId(tbl.id);
                  }
                }}
                className="cursor-pointer"
              >
                <rect
                  x={tbl.x}
                  y={tbl.y}
                  width={boxWidth}
                  height={boxHeight}
                  rx="8"
                  fill="var(--sf)"
                  stroke={strokeColor}
                  strokeWidth={isSel ? 2.4 : 1.4}
                  strokeDasharray={isLabels ? '5 3' : undefined}
                />
                <text
                  x={tbl.x + 10}
                  y={tbl.y + 22}
                  fill={isLabels ? 'var(--flag)' : 'var(--ink)'}
                  fontSize="12.5"
                  fontWeight="700"
                  fontFamily="IBM Plex Mono, monospace"
                >
                  {tbl.table_name}
                </text>
                <text
                  x={tbl.x + 10}
                  y={tbl.y + 39}
                  fill="var(--mut)"
                  fontSize="10.5"
                >
                  {tbl.table_type === 'VIEW' ? 'VIEW · ' : ''}
                  {tbl.columns.length} cols
                  {tbl.columns.some((c) => c.deferrable) ? ' · DEFERRABLE' : ''}
                </text>
                <text
                  x={tbl.x + 10}
                  y={tbl.y + 53}
                  fill="var(--mut)"
                  fontSize="9.5"
                >
                  {tbl.grain.length > 32 ? tbl.grain.slice(0, 31) + '…' : tbl.grain}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Selected Table / View Column & Constraint Inspector */}
      <div className="bg-[var(--bg)] border border-[var(--ln)] rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono-tabular text-base font-bold text-[var(--ink)]">
                {selectedTable.id}
              </span>
              <span className="text-xs text-[var(--mut)]">·</span>
              <span className="font-mono-tabular text-xs text-[var(--mut)]">
                {selectedTable.table_type}
              </span>
              <span className="text-xs text-[var(--mut)]">·</span>
              <span className="text-xs text-[var(--mut)]">{selectedTable.grain}</span>
            </div>
            <p className="text-xs text-[var(--mut)] mt-1">{selectedTable.description}</p>
          </div>

          {selectedTable.schema === 'labels' && artifactMode === 'model_input' && (
            <div className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--flag)]">
              <Lock className="w-3.5 h-3.5" />
              <span>REVOKE ALL FROM model_reader</span>
            </div>
          )}
        </div>

        {selectedTable.omitted_fk_note && (
          <div className="text-xs bg-[var(--sf)] border border-[var(--ln)] rounded-lg px-3 py-2 text-[var(--ink)]">
            <span className="font-semibold text-[var(--flag)]">Isolation rule: </span>
            {selectedTable.omitted_fk_note}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs font-mono-tabular">
            <thead>
              <tr className="border-b border-[var(--ln)] text-[var(--mut)]">
                <th className="text-left py-2 pr-3 font-medium">column_name</th>
                <th className="text-left py-2 pr-3 font-medium">data_type</th>
                <th className="text-left py-2 pr-3 font-medium">key / constraint</th>
                <th className="text-left py-2 font-medium">notes / isolation</th>
              </tr>
            </thead>
            <tbody>
              {selectedTable.columns.map((col) => (
                <tr
                  key={col.column_name}
                  className={`border-b border-[var(--ln)]/60 ${
                    col.stripped_in_model_input ? 'bg-[var(--flag)]/8' : ''
                  }`}
                >
                  <td className="py-1.5 pr-3 font-medium text-[var(--ink)]">
                    {col.column_name}
                  </td>
                  <td className="py-1.5 pr-3 text-[var(--mut)]">{col.data_type}</td>
                  <td className="py-1.5 pr-3">
                    {col.key_type ? (
                      <span className="text-[var(--sell)] font-semibold">
                        {col.key_type}
                        {col.deferrable ? ' (DEFERRABLE)' : ''}
                      </span>
                    ) : col.nullable ? (
                      <span className="text-[var(--mut)]">NULLABLE</span>
                    ) : (
                      <span className="text-[var(--mut)]">NOT NULL</span>
                    )}
                  </td>
                  <td className="py-1.5 text-[var(--mut)] font-sans">
                    {col.references ? `→ ${col.references}` : ''}
                    {col.references && col.note ? ' · ' : ''}
                    {col.note ?? (col.stripped_in_model_input ? 'Stripped in model_input view' : '')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {(selectedTable.constraints.length > 0 || (selectedTable.triggers && selectedTable.triggers.length > 0)) && (
          <div className="pt-2 border-t border-[var(--ln)] grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div>
              <div className="font-semibold text-[var(--ink)] mb-1">CHECK &amp; FK constraints</div>
              <ul className="space-y-1 font-mono-tabular text-[var(--mut)]">
                {selectedTable.constraints.map((c, i) => (
                  <li key={i}>• {c}</li>
                ))}
              </ul>
            </div>
            {selectedTable.triggers && (
              <div>
                <div className="font-semibold text-[var(--ink)] mb-1">Immutability triggers</div>
                <ul className="space-y-1 font-mono-tabular text-[var(--mut)]">
                  {selectedTable.triggers.map((tr, i) => (
                    <li key={i}>• {tr}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  );
};
