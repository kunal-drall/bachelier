import { useState } from "react";
import { IS_DEVNET } from "../lib/config";
import { useWallet } from "../hooks/useWallet";
import { useToasts } from "./Toasts";
import { faucetMint } from "../lib/stacks";

/** Devnet-only faucet: mints 1 sBTC + 10,000 USDC to the connected wallet. */
export default function FaucetButton() {
  const { address, connected } = useWallet();
  const { push, pushTx } = useToasts();
  const [busy, setBusy] = useState(false);

  if (!IS_DEVNET || !connected || !address) return null;

  const onClick = async () => {
    setBusy(true);
    try {
      const { sbtc, usdc } = await faucetMint(address);
      pushTx(sbtc.txid, "Faucet: minting 1 sBTC");
      pushTx(usdc.txid, "Faucet: minting 10,000 USDC");
    } catch (e) {
      push({ kind: "error", title: "Faucet failed", message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <button className="btn btn--secondary btn--sm" onClick={() => void onClick()} disabled={busy} title="Mint test tokens">
      {busy ? "Minting…" : "Faucet"}
    </button>
  );
}
