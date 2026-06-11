import { useState } from "react";
import type { UserPositionsDto, RoundSummaryDto } from "@bachelier/shared/dto";
import { formatSats, formatUsdc, EM_DASH, toBigIntOrNull, parseDecimalToBase } from "../lib/format";
import { useCountdown } from "../hooks/useCountdown";

interface PositionCardProps {
  positions: UserPositionsDto;
  round: RoundSummaryDto | null;
  busy: boolean;
  onWithdraw: (shares: bigint) => void;
  onRequestWithdraw: (shares: bigint) => void;
  onClaim: () => void;
}

/** User's vault position with withdraw/claim actions and live round countdown. */
export default function PositionCard({ positions, round, busy, onWithdraw, onRequestWithdraw, onClaim }: PositionCardProps) {
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [sharesInput, setSharesInput] = useState("");

  const countdown = useCountdown(round?.status === "active" ? round.expiry : null);
  const roundActive = round?.status === "active";

  const totalShares = toBigIntOrNull(positions.shares) ?? 0n;
  const queuedShares = toBigIntOrNull(positions.queuedShares) ?? 0n;
  // shares available to withdraw instantly (not already queued)
  const idleShares = totalShares > queuedShares ? totalShares - queuedShares : 0n;

  const claimable = toBigIntOrNull(positions.claimablePremiumUsdc) ?? 0n;

  // parse the withdraw input (8dp shares) to BigInt
  const requested = parseDecimalToBase(sharesInput, 8);
  const exceedsIdle = requested !== null && requested > idleShares;
  // during an active round, a withdrawal beyond idle must be queued
  const willQueue = roundActive && (exceedsIdle || idleShares === 0n);

  const submit = () => {
    if (requested === null || requested <= 0n) return;
    if (willQueue) onRequestWithdraw(requested);
    else onWithdraw(requested);
    setShowWithdraw(false);
    setSharesInput("");
  };

  return (
    <section className="card card__pad position">
      <div className="cardhead">
        <h3 className="cardhead__title">Your position</h3>
        {queuedShares > 0n && <span className="status status--active">{formatSats(queuedShares)} queued</span>}
      </div>

      <div className="position__grid">
        <div className="position__cell">
          <span className="overline">Shares</span>
          <span className="position__val">{formatSats(positions.shares)}</span>
        </div>
        <div className="position__cell">
          <span className="overline">Value</span>
          <span className="position__val">{formatSats(positions.valueSbtc)} sBTC</span>
        </div>
        <div className="position__cell">
          <span className="overline">Claimable premium</span>
          <span className="position__val accent">{formatUsdc(positions.claimablePremiumUsdc)} USDC</span>
        </div>
        <div className="position__cell">
          <span className="overline">Round expires in</span>
          <span className="position__countdown">{roundActive ? countdown : EM_DASH}</span>
        </div>
      </div>

      <div className="position__actions">
        <button className="btn btn--secondary btn--sm" onClick={() => setShowWithdraw((v) => !v)} disabled={busy || totalShares === 0n}>
          Withdraw
        </button>
        <button className="btn btn--primary btn--sm" onClick={onClaim} disabled={busy || claimable === 0n}>
          Claim premium
        </button>
      </div>

      {showWithdraw && (
        <div className="inline-form">
          <div className="field">
            <label className="overline" htmlFor="wd-shares">
              Shares to withdraw
            </label>
            <div className="input-affix">
              <input
                id="wd-shares"
                className="input input--sm"
                inputMode="decimal"
                placeholder="0.0000"
                value={sharesInput}
                onChange={(e) => setSharesInput(e.target.value)}
              />
              <span className="input-affix__suffix">shares</span>
            </div>
          </div>
          {willQueue && requested !== null && requested > 0n && (
            <p className="inline-form__hint">
              A round is active. This request will be <strong>queued until settlement</strong>, then the sBTC becomes withdrawable.
            </p>
          )}
          <div className="position__actions">
            <button className="btn btn--primary btn--sm" onClick={submit} disabled={busy || requested === null || requested <= 0n}>
              {willQueue ? "Request withdrawal" : "Confirm withdraw"}
            </button>
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => {
                setShowWithdraw(false);
                setSharesInput("");
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
