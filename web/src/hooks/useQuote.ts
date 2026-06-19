import { useQuery } from "@tanstack/react-query";
import { quote as localQuote, type QuoteResult } from "@bachelier/shared/bs";
import type { QuoteDto } from "@bachelier/shared/dto";
import { fetchQuote } from "../lib/api";
import { useDebounced } from "./useDebounced";

export interface QuoteInputs {
  notional: number; // contracts (1 sBTC each)
  otmBps: number;
  iv: number;
}

/** Default tenor / rate used for the instant local estimate (weekly call). */
const T_YEARS = 7 / 365;
const RISK_FREE = 0.04;

/**
 * Combined quote: an instant local Black–Scholes estimate (zero latency) plus
 * the debounced (300ms) authoritative `/quote` response. The UI shows `local`
 * immediately and prefers `remote` once it arrives.
 */
export function useQuote(inputs: QuoteInputs, spot: number | null | undefined) {
  const debounced = useDebounced(inputs, 300);

  const remote = useQuery<QuoteDto>({
    queryKey: ["quote", debounced.notional, debounced.otmBps, debounced.iv],
    queryFn: ({ signal }) => fetchQuote(debounced, signal),
    staleTime: 10_000,
    // the API derives spot itself; we only gate on having valid inputs
    enabled: debounced.notional > 0 && debounced.iv > 0,
  });

  // Instant local estimate — only when we have a spot to price against.
  let local: QuoteResult | null = null;
  if (spot && spot > 0 && inputs.iv > 0 && inputs.notional > 0) {
    local = localQuote({
      spot,
      otmBps: inputs.otmBps,
      iv: inputs.iv,
      tYears: T_YEARS,
      r: RISK_FREE,
      contracts: inputs.notional,
    });
  }

  return { local, remote };
}
