import type { RoundSummaryDto } from "@bachelier/shared/dto";
import { formatUsdFp, formatUsdc, EM_DASH, toBigIntOrNull } from "../lib/format";

interface RoundsTableProps {
  rounds: RoundSummaryDto[] | undefined;
  loading: boolean;
  error: boolean;
}

/** Recent rounds with strike, status chip, premium collected, settlement price. */
export default function RoundsTable({ rounds, loading, error }: RoundsTableProps) {
  return (
    <section className="card rounds">
      <div className="card__pad" style={{ paddingBottom: 8 }}>
        <div className="cardhead" style={{ marginBottom: 0 }}>
          <h2 className="cardhead__title">Recent rounds</h2>
          <span className="overline">Weekly covered calls</span>
        </div>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Round</th>
              <th>Strike</th>
              <th>Status</th>
              <th>Premium collected</th>
              <th>Settlement</th>
            </tr>
          </thead>
          <tbody>
            {rounds && rounds.length > 0 ? (
              rounds.map((r) => <RoundRow key={r.roundId} round={r} />)
            ) : (
              <tr>
                <td colSpan={5}>
                  <div className="empty">
                    {error ? "Couldn't load rounds." : loading ? "Loading rounds…" : "No rounds yet."}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RoundRow({ round }: { round: RoundSummaryDto }) {
  return (
    <tr>
      <td className="num">#{round.roundId}</td>
      <td className="num">{formatUsdFp(round.strike)}</td>
      <td>
        <StatusChip round={round} />
      </td>
      <td className="num">{formatUsdc(round.premiumCollectedUsdc)} USDC</td>
      <td className="num">{round.settlementPrice ? formatUsdFp(round.settlementPrice) : EM_DASH}</td>
    </tr>
  );
}

function StatusChip({ round }: { round: RoundSummaryDto }) {
  if (round.status === "active") {
    return <span className="status status--active">active</span>;
  }
  // settled — compare settlement vs strike to decide OTM (worthless) vs ITM (exercised)
  const strike = toBigIntOrNull(round.strike);
  const settle = toBigIntOrNull(round.settlementPrice);
  if (strike !== null && settle !== null) {
    if (settle < strike) return <span className="status status--otm">expired worthless</span>;
    return <span className="status status--itm">exercised</span>;
  }
  return <span className="status status--otm">settled</span>;
}
