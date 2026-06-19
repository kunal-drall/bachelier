import type { VaultDto } from "@bachelier/shared/dto";
import { formatSats, formatUsdc, formatPct, EM_DASH } from "../lib/format";

interface StatStripProps {
  vault: VaultDto | undefined;
  loading: boolean;
}

interface Cell {
  label: string;
  value: string;
  sub?: string;
}

/** Horizontal vault stats strip for the app page head. */
export default function StatStrip({ vault, loading }: StatStripProps) {
  const cells: Cell[] = [
    { label: "TVL", value: vault ? formatSats(vault.tvlSbtc) : EM_DASH, sub: "sBTC" },
    { label: "Share price", value: vault ? formatSats(vault.sharePrice) : EM_DASH, sub: "sBTC / share" },
    { label: "Premium pool", value: vault ? formatUsdc(vault.premiumPoolUsdc) : EM_DASH, sub: "USDC" },
    {
      label: "Current APY",
      value: vault ? formatPct(vault.forwardApy ?? vault.trailingApy) : EM_DASH,
      sub: vault?.forwardApy != null ? "forward" : "trailing",
    },
    { label: "Capacity", value: vault ? formatSats(vault.capacitySbtc) : EM_DASH, sub: "sBTC writable" },
  ];

  return (
    <div className="statstrip">
      {cells.map((c) => (
        <div className="statstrip__cell" key={c.label}>
          <div className="statstrip__label overline">{c.label}</div>
          <div className="statstrip__value">{loading && !vault ? <span className="skeleton skeleton--wide" /> : c.value}</div>
          {c.sub && <div className="statstrip__sub">{c.sub}</div>}
        </div>
      ))}
    </div>
  );
}
