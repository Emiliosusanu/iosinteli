import { QueryClient } from "@tanstack/react-query";
import { shouldRetryRead } from "./readRequest";

/**
 * App-wide QueryClient singleton. Create + Books share keys like
 * `campaign-creation-books` so Nest shelf rows are not refetched under a
 * divergent cache (Create-has / Books-missing).
 */
export const appQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Same-key hits stay instant via memory + AsyncStorage hydrate.
      // Do NOT reuse a prior query's rows under a new period/profile key —
      // that paints Week numbers under Month labels and wrong entities.
      staleTime: 45_000,
      gcTime: 1000 * 60 * 60 * 24,
      retry: shouldRetryRead,
      refetchOnWindowFocus: false,
    },
  },
});
