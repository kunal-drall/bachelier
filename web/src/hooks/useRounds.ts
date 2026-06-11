import { useQuery } from "@tanstack/react-query";
import { fetchRounds } from "../lib/api";

/** Recent rounds for the table. */
export function useRounds(limit = 20) {
  return useQuery({
    queryKey: ["rounds", limit],
    queryFn: ({ signal }) => fetchRounds(limit, signal),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}
