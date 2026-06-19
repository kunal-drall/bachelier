/**
 * Chainhook webhook payload handling. We only consume `print_event`
 * occurrences from the vault contract; everything else is ignored.
 */
import { decodePrintHex, toVaultEvent, type VaultEvent } from "@bachelier/shared/events";

export interface ChainhookEventData {
  contract_identifier: string;
  topic: string;
  raw_value?: string;
  value?: unknown;
}

export interface ChainhookReceiptEvent {
  type: string;
  position?: { index: number };
  data: ChainhookEventData;
}

export interface ChainhookTx {
  transaction_identifier: { hash: string };
  metadata?: {
    success?: boolean;
    position?: { index: number };
    receipt?: { events?: ChainhookReceiptEvent[] };
  };
}

export interface ChainhookBlock {
  block_identifier: { index: number; hash: string };
  timestamp?: number;
  transactions: ChainhookTx[];
}

export interface ChainhookPayload {
  apply?: ChainhookBlock[];
  rollback?: ChainhookBlock[];
  chainhook?: { uuid?: string; predicate?: unknown };
}

export interface ExtractedEvent {
  txId: string;
  txIndex: number;
  eventIndex: number;
  blockHeight: number;
  blockTime: number | null;
  event: VaultEvent;
  rawPayload: Record<string, unknown>;
}

/** pull decodable vault print events out of one chainhook block */
export function extractBlockEvents(block: ChainhookBlock, vaultContract: string): ExtractedEvent[] {
  const out: ExtractedEvent[] = [];
  const height = block.block_identifier.index;
  const time = block.timestamp ?? null;

  block.transactions.forEach((tx, txPos) => {
    if (tx.metadata?.success === false) return;
    const events = tx.metadata?.receipt?.events ?? [];
    events.forEach((ev, evPos) => {
      const isPrint =
        ev.type === "SmartContractEvent" || ev.type === "smart_contract_log" || ev.data?.topic === "print";
      if (!isPrint) return;
      if (ev.data?.contract_identifier !== vaultContract) return;

      const decoded = decodeEventData(ev.data);
      if (!decoded) return;
      const vaultEvent = toVaultEvent(decoded);
      if (!vaultEvent) return;

      out.push({
        txId: tx.transaction_identifier.hash,
        txIndex: tx.metadata?.position?.index ?? txPos,
        eventIndex: ev.position?.index ?? evPos,
        blockHeight: height,
        blockTime: time,
        event: vaultEvent,
        rawPayload: decoded as Record<string, unknown>,
      });
    });
  });
  return out;
}

/** prefer the hex form; fall back to chainhook's pre-decoded value */
export function decodeEventData(data: ChainhookEventData): Record<string, unknown> | null {
  try {
    if (data.raw_value) return decodePrintHex(data.raw_value) as Record<string, unknown>;
    if (typeof data.value === "string" && data.value.startsWith("0x")) {
      return decodePrintHex(data.value) as Record<string, unknown>;
    }
    if (data.value && typeof data.value === "object") {
      return data.value as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}
