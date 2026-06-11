/**
 * Typed REST fetchers for the read-only API. Every response is parsed against
 * the shared zod DTO so the rest of the app sees validated, well-typed data.
 *
 * Fetchers throw on network/parse failure; callers (react-query hooks) render
 * loading/empty/error states rather than crashing.
 */
import {
  VaultDto,
  VaultHistoryDto,
  RoundsPageDto,
  RoundDetailDto,
  UserPositionsDto,
  QuoteDto,
  PriceDto,
  TxStatusDto,
} from "@bachelier/shared/dto";
import { API_URL } from "./config";

class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function getJson(path: string, signal?: AbortSignal): Promise<unknown> {
  const url = `${API_URL}${path}`;
  let res: Response;
  try {
    res = await fetch(url, { signal, headers: { accept: "application/json" } });
  } catch (e) {
    throw new ApiError(`network error: ${(e as Error).message}`);
  }
  if (!res.ok) {
    throw new ApiError(`request failed: ${res.status} ${res.statusText}`, res.status);
  }
  return res.json();
}

export async function fetchVault(signal?: AbortSignal) {
  return VaultDto.parse(await getJson("/vault", signal));
}

export async function fetchVaultHistory(range = "30d", interval = "1d", signal?: AbortSignal) {
  const q = new URLSearchParams({ range, interval });
  return VaultHistoryDto.parse(await getJson(`/vault/history?${q}`, signal));
}

export async function fetchRounds(limit = 20, signal?: AbortSignal) {
  const q = new URLSearchParams({ limit: String(limit) });
  return RoundsPageDto.parse(await getJson(`/rounds?${q}`, signal));
}

export async function fetchRound(id: number, signal?: AbortSignal) {
  return RoundDetailDto.parse(await getJson(`/rounds/${id}`, signal));
}

export async function fetchPositions(address: string, signal?: AbortSignal) {
  return UserPositionsDto.parse(await getJson(`/positions/${address}`, signal));
}

export interface QuoteParams {
  notional: number;
  otmBps: number;
  iv: number;
}

export async function fetchQuote(params: QuoteParams, signal?: AbortSignal) {
  const q = new URLSearchParams({
    notional: String(params.notional),
    otmBps: String(params.otmBps),
    iv: String(params.iv),
  });
  return QuoteDto.parse(await getJson(`/quote?${q}`, signal));
}

export async function fetchPrice(signal?: AbortSignal) {
  return PriceDto.parse(await getJson("/price", signal));
}

export async function fetchTxStatus(txid: string, signal?: AbortSignal) {
  const id = txid.startsWith("0x") ? txid : `0x${txid}`;
  return TxStatusDto.parse(await getJson(`/tx/${id}`, signal));
}

export { ApiError };
