import React from 'react';

interface ControlCardProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}

export const ControlCard: React.FC<ControlCardProps> = ({
  title,
  subtitle,
  children,
  className = '',
}) => (
  <article
    className={`bg-[var(--bg)] border border-[var(--ln)] rounded-xl p-4 space-y-3 ${className}`}
  >
    <div className="space-y-0.5 pb-2 border-b border-[var(--ln)]/70">
      <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--ink)]">{title}</h4>
      {subtitle && <p className="text-xs text-[var(--mut)]">{subtitle}</p>}
    </div>
    <div className="space-y-3">{children}</div>
  </article>
);

function formatStepValue(val: number, step: number): string {
  const stepStr = String(step);
  const decimals = stepStr.includes('.') ? stepStr.split('.')[1].length : Number.isInteger(val) ? 0 : 2;
  return val.toFixed(decimals);
}

interface RangeKnobProps {
  label: string;
  keyPath: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  rangeMaxValue?: number;
  onChange: (nextVal: number) => void;
  onChangeRangeMax?: (nextMaxVal: number) => void;
  format?: (val: number) => string;
  hint?: string;
  disabled?: boolean;
  complementLabel?: string;
  maxSelectable?: number;
}

export const RangeKnob: React.FC<RangeKnobProps> = ({
  label,
  keyPath,
  min,
  max,
  step = 1,
  value,
  rangeMaxValue,
  onChange,
  onChangeRangeMax,
  format,
  hint,
  disabled = false,
  complementLabel,
  maxSelectable,
}) => {
  const isDual = typeof rangeMaxValue === 'number' && typeof onChangeRangeMax === 'function';
  const fmt = format ?? ((v: number) => formatStepValue(v, step));
  const span = Math.max(1e-9, max - min);
  const hasCap = !isDual && typeof maxSelectable === 'number';
  const effectiveMax = hasCap ? Math.max(min, Math.min(max, maxSelectable)) : max;
  const clampedMin = Math.max(min, Math.min(max, value));
  const clampedMax = isDual ? Math.max(clampedMin, Math.min(max, rangeMaxValue)) : clampedMin;

  const pctLeft = isDual ? ((clampedMin - min) / span) * 100 : 0;
  const pctWidth = isDual
    ? ((clampedMax - clampedMin) / span) * 100
    : ((clampedMin - min) / span) * 100;
  const capPct = hasCap ? ((effectiveMax - min) / span) * 100 : 100;

  const parseRound = (raw: string) => {
    const parsed = parseFloat(raw);
    if (Number.isInteger(step) && step >= 1) return Math.round(parsed);
    return Number(parsed.toFixed(4));
  };

  const complementPct = Math.max(0, 100 - Math.round(clampedMin * 100));

  return (
    <div className={`space-y-1 ${disabled ? 'opacity-55' : ''}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-[var(--ink)]">{label}</span>
        <span className="text-xs font-mono-tabular font-semibold text-[var(--sell)] shrink-0">
          {isDual ? `${fmt(clampedMin)} – ${fmt(clampedMax)}` : fmt(clampedMin)}
        </span>
      </div>
      <div className="text-[11px] font-mono-tabular text-[var(--mut)] break-all">{keyPath}</div>

      <div className="flex items-center gap-2.5">
        <div className="relative h-6 flex-1 flex items-center select-none min-w-0">
          <div className="w-full h-1.5 rounded-full bg-[var(--ln)] relative overflow-hidden">
            <div
              className="absolute top-0 bottom-0 rounded-full"
              style={{
                left: `${pctLeft}%`,
                width: `${Math.max(0, Math.min(100 - pctLeft, pctWidth))}%`,
                backgroundColor: disabled ? 'var(--mut)' : 'var(--sell)',
              }}
            />
            {hasCap && capPct < 100 && (
              <div
                className="absolute top-0 bottom-0 bg-[var(--mut)]/25 border-l border-[var(--mut)]/60"
                style={{ left: `${capPct}%`, right: 0 }}
                title={`Capped at ${fmt(effectiveMax)} so amend split totals 100%`}
              />
            )}
          </div>

          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={clampedMin}
            disabled={disabled}
            aria-label={isDual ? `${label} minimum` : label}
            onChange={(e) => {
              const next = parseRound(e.target.value);
              const bounded = isDual
                ? Math.min(next, clampedMax)
                : hasCap
                  ? Math.min(next, effectiveMax)
                  : next;
              onChange(bounded);
            }}
            className="dual-range-input absolute inset-0 w-full h-6 m-0 z-10"
          />

          {isDual && (
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={clampedMax}
              disabled={disabled}
              aria-label={`${label} maximum`}
              onChange={(e) => {
                const next = parseRound(e.target.value);
                onChangeRangeMax(Math.max(next, clampedMin));
              }}
              className="dual-range-input absolute inset-0 w-full h-6 m-0 z-20"
            />
          )}
        </div>

        {complementLabel && !isDual && (
          <span
            className="inline-flex items-center px-2 py-0.5 rounded border border-dashed border-[var(--mut)]/55 bg-transparent text-[11px] font-mono-tabular text-[var(--mut)] whitespace-nowrap shrink-0 select-none"
            title={`Remaining share: ${complementPct}% ${complementLabel}`}
          >
            {complementPct}% {complementLabel}
          </span>
        )}
      </div>

      <div className="flex items-center justify-between text-[10px] font-mono-tabular text-[var(--mut)]">
        <span>{fmt(min)}</span>
        <span>{fmt(max)}</span>
      </div>
      {hint && <p className="text-[11px] text-[var(--mut)] leading-snug">{hint}</p>}
    </div>
  );
};

interface SelectControlProps {
  label: string;
  keyPath: string;
  value: string;
  options: Array<{ value: string; label: string } | string>;
  onChange: (value: string) => void;
  hint?: string;
  disabled?: boolean;
}

export const SelectControl: React.FC<SelectControlProps> = ({
  label,
  keyPath,
  value,
  options,
  onChange,
  hint,
  disabled = false,
}) => (
  <div className={`space-y-1 ${disabled ? 'opacity-55' : ''}`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0">
        <div className="text-xs font-semibold text-[var(--ink)]">{label}</div>
        <div className="text-[11px] font-mono-tabular text-[var(--mut)] break-all">{keyPath}</div>
      </div>
      <select
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        className="text-xs font-mono-tabular bg-[var(--sf)] text-[var(--ink)] border border-[var(--ln)] rounded-lg px-2.5 py-1.5 min-w-[140px] cursor-pointer disabled:cursor-not-allowed"
      >
        {options.map((opt) => {
          const val = typeof opt === 'string' ? opt : opt.value;
          const lbl = typeof opt === 'string' ? opt : opt.label;
          return (
            <option key={val} value={val}>
              {lbl}
            </option>
          );
        })}
      </select>
    </div>
    {hint && <p className="text-[11px] text-[var(--mut)] leading-snug">{hint}</p>}
  </div>
);

interface TextControlProps {
  label: string;
  keyPath: string;
  type?: 'text' | 'date' | 'number';
  value: string | number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: string) => void;
  hint?: string;
  disabled?: boolean;
}

export const TextControl: React.FC<TextControlProps> = ({
  label,
  keyPath,
  type = 'text',
  value,
  min,
  max,
  step,
  onChange,
  hint,
  disabled = false,
}) => (
  <div className={`space-y-1 ${disabled ? 'opacity-55' : ''}`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0">
        <div className="text-xs font-semibold text-[var(--ink)]">{label}</div>
        <div className="text-[11px] font-mono-tabular text-[var(--mut)] break-all">{keyPath}</div>
      </div>
      <input
        type={type}
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        className="text-xs font-mono-tabular bg-[var(--sf)] text-[var(--ink)] border border-[var(--ln)] rounded-lg px-2.5 py-1.5 min-w-[150px] disabled:cursor-not-allowed"
      />
    </div>
    {hint && <p className="text-[11px] text-[var(--mut)] leading-snug">{hint}</p>}
  </div>
);

interface ToggleControlProps {
  label: string;
  keyPath: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
  disabled?: boolean;
}

export const ToggleControl: React.FC<ToggleControlProps> = ({
  label,
  keyPath,
  checked,
  onChange,
  hint,
  disabled = false,
}) => (
  <label
    className={`flex items-start gap-2.5 text-xs ${
      disabled ? 'opacity-55 cursor-not-allowed' : 'cursor-pointer'
    }`}
  >
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      className="mt-0.5 w-4 h-4 accent-[var(--sell)] cursor-pointer shrink-0"
    />
    <span className="space-y-0.5">
      <span className="block font-semibold text-[var(--ink)]">
        {label}{' '}
        <span className="font-normal font-mono-tabular text-[11px] text-[var(--mut)]">
          · {keyPath}
        </span>
      </span>
      {hint && <span className="block text-[11px] text-[var(--mut)] leading-snug">{hint}</span>}
    </span>
  </label>
);
