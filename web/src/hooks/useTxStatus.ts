import { useQuery } from "@tanstack/react-query";
import type { TxStatusDto } from "@bachelier/shared/dto";
import { fetchTxStatus } from "../lib/api";

const TERMINAL: TxStatusDto["status"][] = ["success", "abort_by_response", "abort_by_post_condition"];

/**
 * Polls /tx/:txid every 3s until the transaction reaches a terminal state.
 * `not_found` keeps polling (mempool lag); explicit aborts/success stop it.
 */
export function useTxStatus(txid: string | null) {
  return useQuery({
    queryKey: ["tx", txid],
    queryFn: ({ signal }) => fetchTxStatus(txid as string, signal),
    enabled: !!txid,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status && TERMINAL.includes(status)) return false;
      return 3000;
    },
    staleTime: 0,
  });
}

export function isTerminal(status: TxStatusDto["status"] | undefined): boolean {
  return !!status && TERMINAL.includes(status);
}
