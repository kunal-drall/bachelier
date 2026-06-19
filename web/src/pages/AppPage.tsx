import { useMemo, useState } from "react";
import TopBar from "../components/TopBar";
import StatStrip from "../components/StatStrip";
import BuilderCard, { type BuilderMode } from "../components/BuilderCard";
import YieldCard from "../components/YieldCard";
import PositionCard from "../components/PositionCard";
import RoundsTable from "../components/RoundsTable";
import { useVault } from "../hooks/useVault";
import { usePrice } from "../hooks/usePrice";
import { usePositions } from "../hooks/usePositions";
import { useRounds } from "../hooks/useRounds";
import { useQuote } from "../hooks/useQuote";
import { useWallet } from "../hooks/useWallet";
import { useToasts } from "../components/Toasts";
import { reconcileQuote } from "../lib/quoteView";
import { parseDecimalToBase, toBigIntOrNull } from "../lib/format";
import * as chain from "../lib/stacks";

export default function AppPage() {
  const { address, connected, connect, connecting } = useWallet();
  const { push, pushTx } = useToasts();

  const vaultQ = useVault();
  const priceQ = usePrice();
  const positionsQ = usePositions(address);
  const roundsQ = useRounds(20);

  const vault = vaultQ.data;
  const spot = priceQ.data?.btcUsd ?? vault?.btcUsd ?? null;
  const round = vault?.currentRound ?? null;

  // ---- builder state (shared between the two panels) ----
  const [mode, setMode] = useState<BuilderMode>("deposit");
  const [amount, setAmount] = useState("");
  const [contracts, setContracts] = useState("1");
  const [otmBps, setOtmBps] = useState(1000);
  const [iv, setIv] = useState(0.55);

  const [busy, setBusy] = useState(false);

  // notional drives the quote: in deposit mode use the entered sBTC (>=1 for a
  // sensible per-sBTC projection); in buy mode use the contracts field.
  const notional = useMemo(() => {
    if (mode === "buy") {
      const n = Number(contracts);
      return Number.isFinite(n) && n > 0 ? n : 1;
    }
    const n = Number(amount);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }, [mode, amount, contracts]);

  const { local, remote } = useQuote({ notional, otmBps, iv }, spot);
  const view = useMemo(() => reconcileQuote(local, remote.data), [local, remote.data]);

  // ---- parsed amounts ----
  const amountSats = parseDecimalToBase(amount, 8);
  const contractsInt = useMemo(() => {
    const t = contracts.trim();
    if (!t || !/^\d+$/.test(t)) return null;
    try {
      const v = BigInt(t);
      return v > 0n ? v : null;
    } catch {
      return null;
    }
  }, [contracts]);

  const hasShares = (toBigIntOrNull(positionsQ.data?.shares ?? null) ?? 0n) > 0n;

  // ---- action handlers ----
  const runTx = async (label: string, fn: () => Promise<chain.CallResult>) => {
    if (!connected) {
      await connect();
      return;
    }
    setBusy(true);
    try {
      const { txid } = await fn();
      pushTx(txid, label);
    } catch (e) {
      const msg = (e as Error).message || "Wallet request was rejected.";
      push({ kind: "error", title: "Transaction not sent", message: msg });
    } finally {
      setBusy(false);
    }
  };

  const onDeposit = () => {
    if (!connected) {
      void connect();
      return;
    }
    if (!address || amountSats === null || amountSats <= 0n) return;
    void runTx("Depositing sBTC", () => chain.deposit(address, amountSats));
  };

  const onBuy = () => {
    if (!connected) {
      void connect();
      return;
    }
    if (!address || contractsInt === null || view.premiumTotal == null) return;
    void runTx("Buying calls", () => chain.buyCall(address, contractsInt, view.premiumTotal as number));
  };

  const onWithdraw = (shares: bigint) => void runTx("Withdrawing sBTC", () => chain.withdraw(shares));
  const onRequestWithdraw = (shares: bigint) => void runTx("Requesting withdrawal", () => chain.requestWithdraw(shares));
  const onClaim = () => void runTx("Claiming premium", () => chain.claimPremium());

  // ---- builder action button label/state ----
  const depositLabel = !connected ? "Connect wallet" : connecting ? "Connecting…" : "Deposit sBTC";
  const depositDisabled = connected ? busy || amountSats === null || amountSats <= 0n : connecting;

  const buyLabel = !connected ? "Connect wallet" : connecting ? "Connecting…" : "Buy calls";
  const buyDisabled = connected ? busy || contractsInt === null || view.premiumTotal == null : connecting;

  return (
    <>
      <TopBar variant="app" />

      <main className="container">
        <div className="pagehead">
          <div className="overline">Vault</div>
          <h1 className="pagehead__title">The covered-call vault.</h1>
          <p className="pagehead__sub">
            Deposit sBTC and earn weekly USDC premium from on-chain Black–Scholes-priced covered calls — or buy this
            week&rsquo;s calls from the pool.
          </p>
        </div>

        <StatStrip vault={vault} loading={vaultQ.isLoading} />

        <div className="panels">
          <BuilderCard
            mode={mode}
            onModeChange={setMode}
            amount={amount}
            onAmountChange={setAmount}
            otmBps={otmBps}
            onOtmChange={setOtmBps}
            iv={iv}
            onIvChange={setIv}
            view={view}
            actionLabel={depositLabel}
            onAction={onDeposit}
            actionDisabled={depositDisabled}
          >
            {connected && hasShares && positionsQ.data && (
              <PositionCard
                positions={positionsQ.data}
                round={round}
                busy={busy}
                onWithdraw={onWithdraw}
                onRequestWithdraw={onRequestWithdraw}
                onClaim={onClaim}
              />
            )}
          </BuilderCard>

          <YieldCard
            view={view}
            loading={remote.isLoading && view.source !== "local"}
            mode={mode}
            contracts={contracts}
            onContractsChange={setContracts}
            onBuy={onBuy}
            buyDisabled={buyDisabled}
            buyLabel={buyLabel}
          />
        </div>

        <RoundsTable rounds={roundsQ.data?.rounds} loading={roundsQ.isLoading} error={roundsQ.isError} />
      </main>

      <div style={{ height: 60 }} />
    </>
  );
}
