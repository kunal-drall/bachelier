import { useQuery } from "@tanstack/react-query";
import { fetchVault } from "../lib/api";

/** Vault summary stats. Polls modestly; safe to fail (empty state in UI). */
export function useVault() {
  return useQuery({
    queryKey: ["vault"],
    queryFn: ({ signal }) => fetchVault(signal),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}
