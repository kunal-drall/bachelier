import type { ReactNode } from "react";
import type { QuoteView } from "../lib/quoteView";
import { formatUsd, formatPct, EM_DASH } from "../lib/format";

export type BuilderMode = "deposit" | "buy";

interface BuilderCardProps {
  mode: BuilderMode;
  onModeChange: (m: BuilderMode) => void;

  // deposit inputs
  amount: string;
  onAmountChange: (v: string) => void;

  // shared pricing inputs
  otmBps: number;
  onOtmChange: (bps: number) => void;
  iv: number;
  onIvChange: (iv: number) => void;

  view: QuoteView;

  // primary action
  actionLabel: string;
  onAction: () => void;
  actionDisabled: boolean;

  /** position card slot, rendered below the builder when the user has shares */
  children?: ReactNode;
}

const OTM_OPTIONS = [
  { label: "5%", bps: 500 },
  { label: "10%", bps: 1000 },
  { label: "15%", bps: 1500 },
];

/** Left panel: deposit / buy-calls builder. Pricing inputs drive the yield panel. */
export default function BuilderCard({
  mode,
  onModeChange,
  amount,
  onAmountChange,
  otmBps,
  onOtmChange,
  iv,
  onIvChange,
  view,
  actionLabel,
  onAction,
  actionDisabled,
  children,
}: BuilderCardProps) {
  return (
    <section className="card card__pad">
      <div className="cardhead">
        <h2 className="cardhead__title">Position builder</h2>
        <div className="tabs" role="tablist">
          <button
            className={`tabs__tab ${mode === "deposit" ? "tabs__tab--active" : ""}`}
            role="tab"
            aria-selected={mode === "deposit"}
            onClick={() => onModeChange("deposit")}
          >
            Deposit
          </button>
          <button
            className={`tabs__tab ${mode === "buy" ? "tabs__tab--active" : ""}`}
            role="tab"
            aria-selected={mode === "buy"}
            onClick={() => onModeChange("buy")}
          >
            Buy calls
          </button>
        </div>
      </div>

      {mode === "deposit" && (
        <div className="field">
          <label className="overline" htmlFor="amount">
            Amount
          </label>
          <div className="input-affix">
            <input
              id="amount"
              className="input"
              inputMode="decimal"
              placeholder="0.0000"
              value={amount}
              onChange={(e) => onAmountChange(e.target.value)}
            />
            <span className="input-affix__suffix">sBTC</span>
          </div>
        </div>
      )}

      {mode === "buy" && (
        <p className="muted" style={{ fontSize: 14, margin: "0 0 4px" }}>
          Choose your strike offset and implied volatility to price this week's call. Enter the number of contracts on the right.
        </p>
      )}

      <div className="controls">
        <div className="controls__row">
          <div className="field">
            <label className="overline" htmlFor="otm">
              Out-of-the-money
            </label>
            <select id="otm" className="select" value={otmBps} onChange={(e) => onOtmChange(Number(e.target.value))}>
              {OTM_OPTIONS.map((o) => (
                <option key={o.bps} value={o.bps}>
                  {o.label} OTM
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <div className="slider-head">
              <label className="overline" htmlFor="iv">
                Implied vol
              </label>
              <span className="slider-val">{iv.toFixed(2)}</span>
            </div>
            <input
              id="iv"
              className="range"
              type="range"
              min={0.3}
              max={0.9}
              step={0.01}
              value={iv}
              onChange={(e) => onIvChange(Number(e.target.value))}
            />
          </div>
        </div>
      </div>

      {/* instant estimate readout (local first, API once it arrives) */}
      <div className="estimate">
        <div className="estimate__cell">
          <span className="estimate__src">{view.source === "api" ? "APY · on-chain" : "APY · estimate"}</span>
          <span className="estimate__val">{view.apy != null ? formatPct(view.apy) : EM_DASH}</span>
        </div>
        <div className="estimate__cell">
          <span className="estimate__src">Weekly premium / sBTC</span>
          <span className="estimate__val accent">{view.premiumPerSbtc != null ? "≈ " + formatUsd(view.premiumPerSbtc) : EM_DASH}</span>
        </div>
        <div className="estimate__cell">
          <span className="estimate__src">Strike</span>
          <span className="estimate__val">{view.strike != null ? formatUsd(view.strike) : EM_DASH}</span>
        </div>
        <div className="estimate__cell">
          <span className="estimate__src">Downside cushion</span>
          <span className="estimate__val">{view.downsideCushionPct != null ? formatPct(view.downsideCushionPct) : EM_DASH}</span>
        </div>
      </div>

      {mode === "deposit" && (
        <button className="btn btn--primary btn--block" style={{ marginTop: 18 }} onClick={onAction} disabled={actionDisabled}>
          {actionLabel}
        </button>
      )}

      {children}
    </section>
  );
}
