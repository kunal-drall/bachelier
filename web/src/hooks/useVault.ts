import { useQuery } from "@tanstack/react-query";
import { fetchVault } from "../lib/api";
import { chainVault } from "../lib/chainRead";

/** Vault summary stats: API first, chain-direct read-only fallback. */
export function useVault() {
  return useQuery({
    queryKey: ["vault"],
    queryFn: ({ signal }) => fetchVault(signal).catch(() => chainVault()),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}
