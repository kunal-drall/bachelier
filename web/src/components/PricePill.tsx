import { usePrice } from "../hooks/usePrice";
import { formatUsd, EM_DASH } from "../lib/format";

/** Live BTC price pill with up/down tick coloring vs the previous poll. */
export default function PricePill() {
  const { data, tick, isError } = usePrice();
  const px = data?.btcUsd;

  const dotClass =
    tick === "up" ? "pricepill__dot pricepill__dot--up" : tick === "down" ? "pricepill__dot pricepill__dot--down" : "pricepill__dot";

  return (
    <div className="pricepill" title="BTC / USD">
      <span className={dotClass} />
      <span className="overline" style={{ fontSize: 10 }}>
        BTC
      </span>
      <span>{px !== undefined ? formatUsd(px) : isError ? EM_DASH : <span className="skeleton" />}</span>
    </div>
  );
}
