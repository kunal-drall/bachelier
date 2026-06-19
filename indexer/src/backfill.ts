/**
 * Historical backfill from the Stacks Blockchain API: page the contract's
 * print events, resolve block heights per tx, and replay them through the
 * same applyBlock path the webhook uses (idempotent by construction).
 */
import type { AnyDb } from "./projector.js";
import { applyBlock } from "./projector.js";
import { decodePrintHex, toVaultEvent } from "@bachelier/shared/events";
import type { ExtractedEvent } from "./chainhook.js";

interface ApiContractEvent {
  event_index: number;
  event_type: string;
  tx_id: string;
  contract_log?: { contract_id: string; topic: string; value: { hex: string; repr: string } };
}

interface ApiTx {
  tx_id: string;
  block_height: number;
  burn_block_time: number;
  tx_index: number;
  tx_status: string;
}

export async function backfill(
  db: AnyDb,
  stacksApiUrl: string,
  vaultContract: string,
  startBlock: number,
  log: (msg: string) => void = console.log
): Promise<number> {
  const events: ApiContractEvent[] = [];
  const limit = 50;
  for (let offset = 0; ; offset += limit) {
    const url = `${stacksApiUrl}/extended/v1/contract/${vaultContract}/events?limit=${limit}&offset=${offset}`;
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 404) break; // contract not deployed yet
      throw new Error(`backfill: ${url} -> ${res.status}`);
    }
    const body = (await res.json()) as { results?: ApiContractEvent[] };
    const page = body.results ?? [];
    events.push(...page.filter((e) => e.event_type === "smart_contract_log"));
    if (page.length < limit) break;
  }
  if (events.length === 0) {
    log("backfill: no historical events");
    return 0;
  }

  // resolve block height / time / tx position for each distinct tx
  const txIds = [...new Set(events.map((e) => e.tx_id))];
  const txMeta = new Map<string, ApiTx>();
  for (const txId of txIds) {
    const res = await fetch(`${stacksApiUrl}/extended/v1/tx/${txId}`);
    if (!res.ok) throw new Error(`backfill: tx ${txId} -> ${res.status}`);
    const tx = (await res.json()) as ApiTx;
    if (tx.tx_status === "success") txMeta.set(txId, tx);
  }

  const extracted: ExtractedEvent[] = [];
  for (const ev of events) {
    const meta = txMeta.get(ev.tx_id);
    if (!meta || meta.block_height < startBlock) continue;
    const hex = ev.contract_log?.value?.hex;
    if (!hex) continue;
    try {
      const plain = decodePrintHex(hex);
      const vaultEvent = toVaultEvent(plain);
      if (!vaultEvent) continue;
      extracted.push({
        txId: ev.tx_id,
        txIndex: meta.tx_index,
        eventIndex: ev.event_index,
        blockHeight: meta.block_height,
        blockTime: meta.burn_block_time,
        event: vaultEvent,
        rawPayload: plain as Record<string, unknown>,
      });
    } catch {
      // not a bachelier print; skip
    }
  }

  // oldest first, grouped per block, through the standard apply path
  extracted.sort((a, b) => a.blockHeight - b.blockHeight || a.txIndex - b.txIndex || a.eventIndex - b.eventIndex);
  const byBlock = new Map<number, ExtractedEvent[]>();
  for (const ev of extracted) {
    const arr = byBlock.get(ev.blockHeight) ?? [];
    arr.push(ev);
    byBlock.set(ev.blockHeight, arr);
  }

  let applied = 0;
  for (const [height, blockEvents] of [...byBlock.entries()].sort((a, b) => a[0] - b[0])) {
    applied += await applyBlock(db, blockEvents, height, blockEvents[0]?.blockTime ?? null);
  }
  log(`backfill: applied ${applied} events across ${byBlock.size} blocks`);
  return applied;
}
