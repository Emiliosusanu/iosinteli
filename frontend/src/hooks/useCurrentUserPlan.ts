import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/src/contexts/AuthContext";
import { fetchCurrentUserPlan } from "@/src/lib/mutations";
import type { NestUserPlan } from "@/src/lib/accountContract";

export type NestPlanQueryStatus = "idle" | "loading" | "success" | "error";

/**
 * Live Nest plan for My Account / Settings. Disabled in guest preview.
 * AuthContext exposes `state` (not `authState`) — alias locally like AppContext.
 */
export function useCurrentUserPlan() {
  const { user, guestMode, state: authState } = useAuth();
  const enabled = authState === "authenticated" && !!user?.id && !guestMode;

  const query = useQuery<NestUserPlan | null>({
    queryKey: ["pricing-plans", "current", user?.id ?? "none"],
    queryFn: fetchCurrentUserPlan,
    enabled,
    staleTime: 60_000,
    retry: 1,
  });

  // Keep last Nest payload across refetch/transient errors; only error when we
  // have never successfully loaded.
  const nestStatus: NestPlanQueryStatus =
    query.isError && query.data === undefined
      ? "error"
      : query.isSuccess || query.data !== undefined
        ? "success"
        : query.isPending && enabled
          ? "loading"
          : "idle";

  const nestPlan: NestUserPlan | null | undefined =
    nestStatus === "error" ? undefined : nestStatus === "success" ? (query.data ?? null) : undefined;

  return { ...query, nestStatus, nestPlan };
}
