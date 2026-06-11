import type { QuoteView } from "../lib/quoteView";
import { formatUsd, formatPct, EM_DASH } from "../lib/format";
import PayoffCanvas from "./PayoffCanvas";

interface YieldCardProps {
  view: QuoteView;
  loading: boolean;
  mode: "deposit" | "buy";
  /** buy-calls controls (rendered only in "buy" mode) */
  contracts: string;
  onContractsChange: (v: string) => void;
  onBuy: () => void;
  buyDisabled: boolean;
  buyLabel: string;
}

/** Right panel: projected-yield figures + payoff canvas (+ buy controls). */
export default function YieldCard({
  view,
  loading,
  mode,
  contracts,
  onContractsChange,
  onBuy,
  buyDisabled,
  buyLabel,
}: YieldCardProps) {
  const apyStr = view.apy != null ? formatPct(view.apy) : loading ? "…" : EM_DASH;

  return (
    <section className="card card__pad">
      <div className="cardhead">
        <h2 className="cardhead__title">Projected yield</h2>
        <span className="overline">{sourceLabel(view.source)}</span>
      </div>

      <div className="yieldfig">
        <div>
          <div className="yieldfig__apy-label overline">Annualized (weekly-compounded)</div>
          <div className="yieldfig__apy">{apyStr}</div>
        </div>
        <div className="yieldgrid__cell">
          <span className="overline">Weekly premium / sBTC</span>
          <span className="yieldgrid__val accent">
            {view.premiumPerSbtc != null ? "≈ " + formatUsd(view.premiumPerSbtc) : EM_DASH}
          </span>
        </div>
      </div>

      <div className="yieldgrid">
        <div className="yieldgrid__cell">
          <span className="overline">Downside cushion</span>
          <span className="yieldgrid__val">{view.downsideCushionPct != null ? formatPct(view.downsideCushionPct) : EM_DASH}</span>
        </div>
        <div className="yieldgrid__cell">
          <span className="overline">Breakeven</span>
          <span className="yieldgrid__val">{view.breakeven != null ? formatUsd(view.breakeven) : EM_DASH}</span>
        </div>
        <div className="yieldgrid__cell">
          <span className="overline">Strike</span>
          <span className="yieldgrid__val">{view.strike != null ? formatUsd(view.strike) : EM_DASH}</span>
        </div>
        <div className="yieldgrid__cell">
          <span className="overline">Cap value (K + premium)</span>
          <span className="yieldgrid__val">{view.capValue != null ? formatUsd(view.capValue) : EM_DASH}</span>
        </div>
      </div>

      {view.onChain && (
        <p className="faint" style={{ fontSize: 12, margin: "0 0 14px" }}>
          On-chain pricer agrees within{" "}
          <span className="mono">{view.onChain.agreesWithinPct.toFixed(2)}%</span>.
        </p>
      )}

      <div className="payoff">
        <PayoffCanvas spot={view.spot} strike={view.strike} premiumPerSbtc={view.premiumPerSbtc} />
        <div className="payoff__legend">
          <span className="payoff__key">
            <span className="payoff__swatch payoff__swatch--hold" /> Hold 1 BTC
          </span>
          <span className="payoff__key">
            <span className="payoff__swatch payoff__swatch--cc" /> Covered call
          </span>
          <span className="payoff__key">
            <span className="payoff__swatch payoff__swatch--sold" /> Upside sold
          </span>
        </div>
      </div>

      {mode === "buy" && (
        <>
          <hr className="divider" style={{ margin: "20px 0 18px" }} />
          <div className="field">
            <label className="overline" htmlFor="contracts">
              Contracts (1 sBTC each)
            </label>
            <input
              id="contracts"
              className="input"
              inputMode="numeric"
              placeholder="0"
              value={contracts}
              onChange={(e) => onContractsChange(e.target.value)}
            />
          </div>
          <div className="estimate" style={{ marginTop: 14 }}>
            <div className="estimate__cell">
              <span className="estimate__src">Total premium</span>
              <span className="estimate__val accent">{view.premiumTotal != null ? formatUsd(view.premiumTotal, { cents: true }) : EM_DASH}</span>
            </div>
            <div className="estimate__cell">
              <span className="estimate__src">Max with 2% slippage</span>
              <span className="estimate__val">
                {view.premiumTotal != null ? formatUsd(view.premiumTotal * 1.02, { cents: true }) : EM_DASH}
              </span>
            </div>
          </div>
          <button className="btn btn--primary btn--block" style={{ marginTop: 16 }} onClick={onBuy} disabled={buyDisabled}>
            {buyLabel}
          </button>
        </>
      )}
    </section>
  );
}

function sourceLabel(source: QuoteView["source"]): string {
  if (source === "api") return "On-chain pricer";
  if (source === "local") return "Local estimate";
  return "Awaiting price";
}
