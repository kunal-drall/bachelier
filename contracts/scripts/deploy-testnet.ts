/**
 * Deploy the Bachelier contracts to Stacks TESTNET with a generated wallet.
 *
 *   pnpm tsx scripts/deploy-testnet.ts
 *
 * - generates (or reuses) a deployer wallet in settings/.testnet-deployer.json
 *   (gitignored -- testnet-only key)
 * - funds it from the Hiro testnet faucet
 * - publishes the 8 contracts in dependency order (clarity 3)
 * - wires: bcshare-token.set-vault, oracle max-age, live BTC price, round 1
 * - verifies the on-chain Black-Scholes reference vector and vault state
 * - records everything in deployments/testnet-deployment.json (committed)
 *
 * Idempotent: re-running skips contracts that already exist and wiring that
 * is already in place.
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { generateSecretKey, generateWallet } from "@stacks/wallet-sdk";
import {
  broadcastTransaction,
  makeContractCall,
  makeContractDeploy,
  getAddressFromPrivateKey,
  fetchCallReadOnlyFunction,
  Cl,
  cvToJSON,
  PostConditionMode,
  ClarityVersion,
} from "@stacks/transactions";
import { STACKS_TESTNET, type StacksNetwork } from "@stacks/network";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const API = process.env.STACKS_API_URL ?? "https://api.testnet.hiro.so";
const network: StacksNetwork = { ...STACKS_TESTNET, client: { ...STACKS_TESTNET.client, baseUrl: API } };

const WALLET_FILE = path.join(root, "settings/.testnet-deployer.json");
const RECORD_FILE = path.join(root, "deployments/testnet-deployment.json");

// dependency order; fees sized to source length with headroom
const CONTRACTS: Array<{ name: string; file: string; fee: bigint }> = [
  { name: "sip-010-trait", file: "contracts/sip-010-trait.clar", fee: 60_000n },
  { name: "bs-math", file: "contracts/bs-math.clar", fee: 200_000n },
  { name: "pyth-mock", file: "contracts/mocks/pyth-mock.clar", fee: 80_000n },
  { name: "oracle-adapter", file: "contracts/oracle-adapter.clar", fee: 100_000n },
  { name: "bcshare-token", file: "contracts/bcshare-token.clar", fee: 100_000n },
  { name: "sbtc-token", file: "contracts/mocks/sbtc-token.clar", fee: 80_000n },
  { name: "usdc-token", file: "contracts/mocks/usdc-token.clar", fee: 80_000n },
  { name: "vault", file: "contracts/vault.clar", fee: 500_000n },
];
const CALL_FEE = 30_000n;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface WalletInfo {
  mnemonic: string;
  privateKey: string;
  address: string;
}

async function loadOrCreateWallet(): Promise<WalletInfo> {
  if (fs.existsSync(WALLET_FILE)) {
    const w = JSON.parse(fs.readFileSync(WALLET_FILE, "utf8")) as WalletInfo;
    console.log(`reusing deployer ${w.address}`);
    return w;
  }
  const mnemonic = generateSecretKey(256);
  const wallet = await generateWallet({ secretKey: mnemonic, password: "" });
  const privateKey = wallet.accounts[0].stxPrivateKey;
  const address = getAddressFromPrivateKey(privateKey, "testnet");
  const info: WalletInfo = { mnemonic, privateKey, address };
  fs.mkdirSync(path.dirname(WALLET_FILE), { recursive: true });
  fs.writeFileSync(WALLET_FILE, JSON.stringify(info, null, 2));
  console.log(`generated deployer ${address} (saved to settings/.testnet-deployer.json)`);
  return info;
}

async function stxBalance(address: string): Promise<bigint> {
  const res = await fetch(`${API}/extended/v1/address/${address}/balances`);
  if (!res.ok) throw new Error(`balance fetch failed: ${res.status}`);
  const body = (await res.json()) as { stx: { balance: string } };
  return BigInt(body.stx.balance);
}

async function ensureFunded(address: string): Promise<void> {
  let bal = await stxBalance(address);
  if (bal >= 5_000_000n) {
    console.log(`balance ${Number(bal) / 1e6} STX -- sufficient`);
    return;
  }
  console.log("requesting testnet STX from the Hiro faucet...");
  const res = await fetch(`${API}/extended/v1/faucets/stx?address=${address}`, { method: "POST" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`faucet request failed (${res.status}): ${text}\n` +
      `fund ${address} manually at https://explorer.hiro.so/sandbox/faucet?chain=testnet and re-run`);
  }
  const body = (await res.json()) as { txId?: string };
  console.log(`faucet tx ${body.txId ?? "?"} -- waiting for funds...`);
  for (let i = 0; i < 60; i++) {
    await sleep(5000);
    bal = await stxBalance(address);
    if (bal >= 5_000_000n) {
      console.log(`funded: ${Number(bal) / 1e6} STX`);
      return;
    }
  }
  throw new Error("faucet funds did not arrive within 5 minutes");
}

async function contractExists(deployer: string, name: string): Promise<boolean> {
  const res = await fetch(`${API}/v2/contracts/interface/${deployer}/${name}`);
  return res.ok;
}

async function nextNonce(address: string): Promise<bigint> {
  const res = await fetch(`${API}/extended/v1/address/${address}/nonces`);
  const body = (await res.json()) as { possible_next_nonce: number };
  return BigInt(body.possible_next_nonce);
}

async function waitTx(txid: string, label: string): Promise<void> {
  const id = txid.startsWith("0x") ? txid : `0x${txid}`;
  for (let i = 0; i < 120; i++) {
    await sleep(5000);
    const res = await fetch(`${API}/extended/v1/tx/${id}`);
    if (res.ok) {
      const tx = (await res.json()) as { tx_status: string; tx_result?: { repr?: string } };
      if (tx.tx_status === "success") {
        console.log(`  ok ${label} (${id})`);
        return;
      }
      if (tx.tx_status.startsWith("abort")) {
        throw new Error(`${label} aborted: ${tx.tx_status} ${tx.tx_result?.repr ?? ""} (${id})`);
      }
    }
  }
  throw new Error(`${label} not confirmed after 10 minutes (${id})`);
}

async function readOnly(deployer: string, contract: string, fn: string, args: any[] = []): Promise<any> {
  const cv = await fetchCallReadOnlyFunction({
    contractAddress: deployer,
    contractName: contract,
    functionName: fn,
    functionArgs: args,
    senderAddress: deployer,
    network,
  });
  return cvToJSON(cv);
}

async function liveBtcPriceFp(): Promise<bigint> {
  const sources: Array<[string, (b: any) => unknown]> = [
    ["https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd", (b) => b?.bitcoin?.usd],
    ["https://api.coinbase.com/v2/prices/BTC-USD/spot", (b) => b?.data?.amount],
  ];
  for (const [src, pick] of sources) {
    try {
      const res = await fetch(src, { signal: AbortSignal.timeout(10_000) });
      const n = Number(pick(await res.json()));
      if (Number.isFinite(n) && n > 1000) {
        console.log(`live BTC-USD: $${n} (${new URL(src).hostname})`);
        return BigInt(Math.round(n * 1e8));
      }
    } catch {
      // try next source
    }
  }
  console.log("price sources unreachable; using reference $104,210");
  return 10_421_000_000_000n;
}

async function main() {
  const wallet = await loadOrCreateWallet();
  const { address, privateKey } = wallet;
  await ensureFunded(address);

  let nonce = await nextNonce(address);
  const deployTxs: Record<string, string> = {};

  // --- publish contracts -----------------------------------------------------
  const pending: Array<{ name: string; txid: string }> = [];
  for (const c of CONTRACTS) {
    if (await contractExists(address, c.name)) {
      console.log(`skip ${c.name} (already deployed)`);
      continue;
    }
    const codeBody = fs.readFileSync(path.join(root, c.file), "utf8");
    const tx = await makeContractDeploy({
      contractName: c.name,
      codeBody,
      senderKey: privateKey,
      network,
      nonce: nonce++,
      fee: c.fee,
      clarityVersion: ClarityVersion.Clarity3,
      postConditionMode: PostConditionMode.Deny,
    });
    const result = await broadcastTransaction({ transaction: tx, network });
    if ("error" in result && result.error) throw new Error(`broadcast ${c.name}: ${JSON.stringify(result)}`);
    console.log(`deploying ${c.name} -> 0x${result.txid}`);
    deployTxs[c.name] = `0x${result.txid}`;
    pending.push({ name: c.name, txid: result.txid });
  }
  for (const p of pending) await waitTx(p.txid, `deploy ${p.name}`);

  // --- wiring ------------------------------------------------------------------
  const call = async (contract: string, fn: string, args: any[], label: string) => {
    const tx = await makeContractCall({
      contractAddress: address,
      contractName: contract,
      functionName: fn,
      functionArgs: args,
      senderKey: privateKey,
      network,
      nonce: nonce++,
      fee: CALL_FEE,
      postConditionMode: PostConditionMode.Deny,
    });
    const result = await broadcastTransaction({ transaction: tx, network });
    if ("error" in result && result.error) throw new Error(`broadcast ${label}: ${JSON.stringify(result)}`);
    console.log(`${label} -> 0x${result.txid}`);
    await waitTx(result.txid, label);
    return `0x${result.txid}`;
  };

  const wiring: Record<string, string> = {};

  const bcVault = await readOnly(address, "bcshare-token", "get-vault");
  if (bcVault.value !== `${address}.vault`) {
    wiring["set-vault"] = await call("bcshare-token", "set-vault", [Cl.contractPrincipal(address, "vault")], "bcshare-token.set-vault");
  } else console.log("skip set-vault (already wired)");

  const maxAge = await readOnly(address, "oracle-adapter", "get-max-age");
  if (BigInt(maxAge.value) < 691_200n) {
    // demo relaxation: keep the round buyable all week without a live relayer
    wiring["set-max-age"] = await call("oracle-adapter", "set-max-age", [Cl.uint(691_200n)], "oracle-adapter.set-max-age(8d)");
  } else console.log("skip set-max-age (already relaxed)");

  const priceFp = await liveBtcPriceFp();
  wiring["set-price"] = await call("pyth-mock", "set-price-now", [Cl.int(priceFp)], `pyth-mock.set-price-now($${Number(priceFp) / 1e8})`);

  const state = cvToJSON(
    await fetchCallReadOnlyFunction({
      contractAddress: address, contractName: "vault", functionName: "get-vault-state",
      functionArgs: [], senderAddress: address, network,
    })
  );
  const currentRound = BigInt(state.value["current-round"].value);
  if (currentRound === 0n) {
    wiring["start-round"] = await call("vault", "start-round", [Cl.uint(1000n), Cl.uint(55_000_000n)], "vault.start-round(+10%, iv 0.55)");
  } else console.log(`skip start-round (round ${currentRound} exists)`);

  // --- verify --------------------------------------------------------------------
  console.log("\nverifying on-chain Black-Scholes reference vector...");
  const bs = await readOnly(address, "bs-math", "bs-call-price", [
    Cl.int(10_421_000_000_000n), Cl.int(11_463_100_000_000n), Cl.int(55_000_000n), Cl.int(1_917_808n), Cl.int(4_000_000n),
  ]);
  const priced = BigInt(bs.value.value);
  console.log(`  bs-call-price(reference) = ${priced} ($${Number(priced) / 1e8})`);
  if (priced !== 42_848_661_381n) throw new Error("reference vector mismatch on testnet!");

  const oracle = await readOnly(address, "oracle-adapter", "get-btc-price");
  if (oracle.success === false) throw new Error(`oracle not fresh: ${JSON.stringify(oracle)}`);
  console.log(`  oracle fresh: $${Number(BigInt(oracle.value.value.price.value)) / 1e8}`);

  const round = await readOnly(address, "vault", "get-round", [Cl.uint(1n)]);
  const expiry = Number(round.value.value.expiry.value);
  console.log(`  round 1 active, strike ${round.value.value.strike.value}, expires ${new Date(expiry * 1000).toISOString()}`);

  // --- record ---------------------------------------------------------------------
  const record = {
    network: "testnet",
    stacksApi: API,
    deployer: address,
    deployedAt: new Date().toISOString(),
    contracts: Object.fromEntries(CONTRACTS.map((c) => [c.name, `${address}.${c.name}`])),
    deployTxs,
    wiring,
    round1: { strike: round.value.value.strike.value, expiry },
    btcUsdAtDeploy: Number(priceFp) / 1e8,
  };
  fs.writeFileSync(RECORD_FILE, JSON.stringify(record, null, 2) + "\n");
  console.log(`\nrecorded -> deployments/testnet-deployment.json`);
  console.log(`\nDEPLOYER ADDRESS: ${address}`);
  console.log(`explorer: https://explorer.hiro.so/address/${address}?chain=testnet`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
