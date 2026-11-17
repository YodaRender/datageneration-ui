import React from 'react';
import {
  BookLadderLevel,
  BookSnapshot,
  ScenarioManifestRow,
} from '../types/surveillance';
import { formatSessionClock } from '../data/syntheticRunGenerator';

interface OrderBookLadderProps {
  cursorTimeSec: number;
  isPinned: boolean;
  onClearPin: () => void;
  bookMode: 'snapshot' | 'replay';
  onChangeBookMode: (mode: 'snapshot' | 'replay') => void;
  snapshot: BookSnapshot | null;
  replayedBook: {
    bids: BookLadderLevel[];
    asks: BookLadderLevel[];
    lastSequenceNumber: number;
    activeOrderCount: number;
  };
  clickedOrderId: string | null;
  clickedOrderPrice: number | null;
  canReveal: boolean;
  orderScenarioMap: Record<string, { scenario_id: string; role: string }>;
  scenarioById: Map<string, ScenarioManifestRow>;
}

export const OrderBookLadder: React.FC<OrderBookLadderProps> = ({
  cursorTimeSec,
  isPinned,
  onClearPin,
  bookMode,
  onChangeBookMode,
  snapshot,
  replayedBook,
  clickedOrderId,
  clickedOrderPrice,
  canReveal,
  orderScenarioMap,
  scenarioById,
}) => {
  const asks: BookLadderLevel[] =
    bookMode === 'snapshot' && snapshot
      ? snapshot.ask_prices
          .map((p, i) => ({
            price: p,
            total_qty: snapshot.ask_depths[i] ?? 0,
            order_count: snapshot.ask_order_counts[i] ?? 0,
          }))
          .slice(0, 6)
          .reverse()
      : replayedBook.asks.slice(0, 7).reverse();

  const bids: BookLadderLevel[] =
    bookMode === 'snapshot' && snapshot
      ? snapshot.bid_prices
          .map((p, i) => ({
            price: p,
            total_qty: snapshot.bid_depths[i] ?? 0,
            order_count: snapshot.bid_order_counts[i] ?? 0,
          }))
          .slice(0, 6)
      : replayedBook.bids.slice(0, 7);

  const maxDepth = Math.max(
    1,
    ...asks.map((l) => l.total_qty),
    ...bids.map((l) => l.total_qty)
  );

  const bestAsk = asks.length > 0 ? asks[asks.length - 1].price : snapshot?.best_ask_price ?? null;
  const bestBid = bids.length > 0 ? bids[0].price : snapshot?.best_bid_price ?? null;
  const spread = bestAsk != null && bestBid != null ? Math.max(0, bestAsk - bestBid) : snapshot?.spread ?? 0;

  const renderLevel = (lvl: BookLadderLevel, side: 'BUY' | 'SELL') => {
    const pct = Math.min(100, (lvl.total_qty / maxDepth) * 100);
    const isClickedLevel =
      clickedOrderPrice != null && Math.abs(lvl.price - clickedOrderPrice) < 0.001;

    // Check if any resting order at this price level is seeded/control (when revealed)
    const restingOrders = lvl.orders ?? [];
    let hasPositive = false;
    let hasHardNeg = false;
    if (canReveal && bookMode === 'replay') {
      for (const o of restingOrders) {
        const meta = orderScenarioMap[o.order_id];
        const scn = meta ? scenarioById.get(meta.scenario_id) : undefined;
        if (scn?.evaluation_label === 'POSITIVE_TEST') hasPositive = true;
        else if (scn?.evaluation_label === 'NEGATIVE_CONTROL') hasHardNeg = true;
      }
    }

    const barColor = hasPositive
      ? 'var(--flag)'
      : hasHardNeg
        ? 'var(--look)'
        : side === 'BUY'
          ? 'var(--buy)'
          : 'var(--sell)';

    return (
      <div
        key={`${side}-${lvl.price.toFixed(2)}`}
        className={`relative px-2 py-1 rounded text-[11px] font-mono-tabular transition-colors ${
          isClickedLevel
            ? 'ring-1 ring-[var(--ink)] bg-[var(--sf-alt)]'
            : hasPositive
              ? 'bg-[var(--flag)]/10'
              : hasHardNeg
                ? 'bg-[var(--look)]/12'
                : ''
        }`}
      >
        {/* Proportional resting depth bar */}
        <div
          className="absolute inset-y-0 right-0 opacity-18 pointer-events-none rounded-r"
          style={{ width: `${pct}%`, backgroundColor: barColor }}
        />

        <div className="relative flex items-center justify-between gap-2">
          <span
            className="font-semibold"
            style={{
              color: hasPositive
                ? 'var(--flag)'
                : hasHardNeg
                  ? 'var(--look)'
                  : side === 'BUY'
                    ? 'var(--buy)'
                    : 'var(--sell)',
            }}
          >
            {lvl.price.toFixed(2)}
          </span>
          <span className="text-[var(--mut)]">{lvl.order_count} ord</span>
          <span className="font-semibold text-[var(--ink)] text-right min-w-[46px]">
            {lvl.total_qty.toLocaleString()}
          </span>
        </div>

        {/* Per-order breakdown in Event Replay mode */}
        {bookMode === 'replay' && restingOrders.length > 0 && (
          <div className="relative mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px]">
            {restingOrders.slice(0, 3).map((ord) => {
              const meta = canReveal ? orderScenarioMap[ord.order_id] : undefined;
              const scn = meta ? scenarioById.get(meta.scenario_id) : undefined;
              const isClickedOrd = ord.order_id === clickedOrderId;
              const ordColor =
                scn?.evaluation_label === 'POSITIVE_TEST'
                  ? 'text-[var(--flag)] font-semibold'
                  : scn?.evaluation_label === 'NEGATIVE_CONTROL'
                    ? 'text-[var(--look)] font-semibold'
                    : 'text-[var(--mut)]';

              return (
                <span
                  key={ord.order_id}
                  className={`${ordColor} ${isClickedOrd ? 'underline font-bold text-[var(--ink)]' : ''}`}
                  title={`${ord.order_id} · ${ord.participant_id} · rem ${ord.remaining_qty}`}
                >
                  {ord.participant_id}:{ord.remaining_qty}
                  {scn ? `(${scn.scenario_id})` : ''}
                </span>
              );
            })}
            {restingOrders.length > 3 && (
              <span className="text-[var(--mut)]">+{restingOrders.length - 3}</span>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside
      aria-label="Order book ladder at cursor time"
      className="bg-[var(--bg)] border border-[var(--ln)] rounded-xl p-3 flex flex-col justify-between gap-2.5"
    >
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[11px] text-[var(--mut)]">
              Order book · {isPinned ? 'Pinned cursor' : 'Hover preview'}
            </div>
            <div className="font-mono-tabular text-sm font-bold text-[var(--ink)]">
              {formatSessionClock(cursorTimeSec)}
            </div>
          </div>

          {isPinned && (
            <button
              type="button"
              onClick={onClearPin}
              className="text-[11px] px-2 py-1 rounded border border-[var(--ln)] bg-[var(--sf)] text-[var(--ink)] hover:bg-[var(--sf-alt)] cursor-pointer"
            >
              Unpin
            </button>
          )}
        </div>

        {/* Mode toggle: book_snapshots vs order_events replay */}
        <div
          role="group"
          aria-label="Order book reconstruction source"
          className="grid grid-cols-2 p-0.5 bg-[var(--sf)] border border-[var(--ln)] rounded-lg gap-0.5 text-[11px]"
        >
          <button
            type="button"
            onClick={() => onChangeBookMode('snapshot')}
            aria-pressed={bookMode === 'snapshot'}
            className={`py-1 px-2 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap ${
              bookMode === 'snapshot'
                ? 'bg-[var(--ink)] text-[var(--bg)]'
                : 'text-[var(--mut)] hover:text-[var(--ink)]'
            }`}
          >
            book_snapshots
          </button>
          <button
            type="button"
            onClick={() => onChangeBookMode('replay')}
            aria-pressed={bookMode === 'replay'}
            className={`py-1 px-2 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap ${
              bookMode === 'replay'
                ? 'bg-[var(--ink)] text-[var(--bg)]'
                : 'text-[var(--mut)] hover:text-[var(--ink)]'
            }`}
          >
            Event replay
          </button>
        </div>

        <div className="font-mono-tabular text-[10px] text-[var(--mut)]">
          {bookMode === 'snapshot'
            ? snapshot
              ? `${snapshot.snapshot_id} · seq ${snapshot.sequence_number} · ${snapshot.book_status}`
              : 'No snapshot'
            : `Replayed to seq #${replayedBook.lastSequenceNumber} · ${replayedBook.activeOrderCount} resting orders`}
        </div>

        {/* Ladder Header */}
        <div className="flex justify-between text-[10px] font-mono-tabular text-[var(--mut)] px-2 pt-1 border-t border-[var(--ln)]">
          <span>price</span>
          <span>orders</span>
          <span>resting qty</span>
        </div>

        {/* Asks */}
        <div className="space-y-0.5">
          {asks.length > 0 ? (
            asks.map((lvl) => renderLevel(lvl, 'SELL'))
          ) : (
            <div className="text-[11px] text-[var(--mut)] px-2 py-2">No resting asks</div>
          )}
        </div>

        {/* Spread / Mid Divider */}
        <div className="flex items-center justify-between px-2 py-1 bg-[var(--sf)] border border-[var(--ln)] rounded text-[11px] font-mono-tabular">
          <span className="text-[var(--mut)]">Spread</span>
          <span className="font-semibold text-[var(--ink)]">{spread.toFixed(2)}</span>
          <span className="text-[var(--mut)]">
            Mid {snapshot ? snapshot.mid_price.toFixed(2) : '—'}
          </span>
        </div>

        {/* Bids */}
        <div className="space-y-0.5">
          {bids.length > 0 ? (
            bids.map((lvl) => renderLevel(lvl, 'BUY'))
          ) : (
            <div className="text-[11px] text-[var(--mut)] px-2 py-2">No resting bids</div>
          )}
        </div>
      </div>

      <div className="pt-2 border-t border-[var(--ln)] text-[10px] text-[var(--mut)] leading-snug">
        {bookMode === 'snapshot'
          ? 'Aggregated L2 arrays from book_snapshots. Switch to Event replay or select a scenario for order-level attribution.'
          : 'Rebuilt by replaying core.order_events from session open so pre-existing resting orders stay accurate.'}
      </div>
    </aside>
  );
};
