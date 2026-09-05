import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useApp } from "@/src/contexts/AppContext";
import { useAuth } from "@/src/contexts/AuthContext";
import { presentRoyaltySetupAsk, useRoyaltySetupNavigation } from "@/src/components/KdpRoyaltySetupCard";
import { fetchKdpAccounts } from "@/src/lib/mutations";
import { getKdpHelperStatus, subscribeKdpHelperStatus } from "@/src/lib/kdp/runtime";
import { loadHelperSyncState } from "@/src/lib/kdp/persist";
import { isIosHelperEnabled } from "@/src/lib/kdp/source";
import {
  planKdpRoyaltySetup,
  royaltyCollectionShortcut,
  type RoyaltySetupActionId,
  type RoyaltySetupAsk,
  type RoyaltySetupPlan,
} from "@/src/lib/kdpRoyaltySetup";
import { emptyRoyaltySetupMemory } from "@/src/lib/kdpRoyaltySetup";
import {
  dismissRoyaltySetup,
  loadRoyaltySetupMemory,
  rememberRoyaltySetupAsked,
} from "@/src/lib/kdpRoyaltySetupStore";

export function useKdpRoyaltySetupPrompt(opts: {
  enabled: boolean;
  royaltyScopeReason?: string | null;
  latestImportedYmd: string | null;
  yesterdayYmd: string;
}) {
  const { guestMode, user } = useAuth();
  const {
    adminFilterUserId,
    kdpRoyaltySource,
    setKdpRoyaltySource,
    selectedProfileIds,
    profiles,
  } = useApp();
  const viewingCustomer = !!adminFilterUserId;
  const nav = useRoyaltySetupNavigation();
  const [memory, setMemory] = useState(emptyRoyaltySetupMemory);
  const [memoryReady, setMemoryReady] = useState(false);
  const [helperRun, setHelperRun] = useState({ lastHelperRunAtMs: 0, lastHelperRunYmd: null as string | null });
  const [helperLive, setHelperLive] = useState(() => getKdpHelperStatus());
  const askedRef = useRef<string | null>(null);

  const accountsQ = useQuery({
    queryKey: ["kdp-accounts", user?.id ?? "guest"],
    queryFn: fetchKdpAccounts,
    enabled: opts.enabled && !!user?.id && !guestMode && !viewingCustomer,
    staleTime: 60_000,
  });

  useEffect(() => {
    return subscribeKdpHelperStatus(setHelperLive);
  }, []);

  useEffect(() => {
    if (!opts.enabled) return;
    let cancelled = false;
    void Promise.all([loadRoyaltySetupMemory(), loadHelperSyncState()]).then(([nextMemory, state]) => {
      if (cancelled) return;
      setMemory(nextMemory);
      setHelperRun({
        lastHelperRunAtMs: Number(state.lastRunAtMs) || 0,
        lastHelperRunYmd: state.lastRunYmd,
      });
      setMemoryReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [opts.enabled, user?.id]);

  const viewProfileIds = useMemo(() => {
    const ids = new Set<string>();
    for (const id of selectedProfileIds) {
      if (id) ids.add(id);
    }
    for (const profile of profiles) {
      if (!selectedProfileIds.includes(profile.id) && !selectedProfileIds.includes(profile.profile_id)) {
        continue;
      }
      if (profile.id) ids.add(profile.id);
      if (profile.profile_id) ids.add(profile.profile_id);
    }
    return [...ids];
  }, [profiles, selectedProfileIds]);

  const plan: RoyaltySetupPlan = useMemo(() => {
    if (!opts.enabled || !memoryReady) return { kind: "none" };
    return planKdpRoyaltySetup({
      guest: guestMode || !user?.id,
      viewingCustomer,
      loading: accountsQ.isPending && accountsQ.data === undefined,
      accountsError: accountsQ.isError && accountsQ.data === undefined,
      royaltyScopeReason: opts.royaltyScopeReason,
      source: kdpRoyaltySource,
      helperLoggedIn: helperLive.loggedIn,
      helperRunning: helperLive.running,
      lastHelperRunAtMs: helperRun.lastHelperRunAtMs,
      lastHelperRunYmd: helperRun.lastHelperRunYmd,
      accounts: accountsQ.data ?? [],
      viewProfileIds,
      latestImportedYmd: opts.latestImportedYmd,
      yesterdayYmd: opts.yesterdayYmd,
      nowMs: Date.now(),
      dismissedUntilMs: memory.dismissedUntilMs,
    });
  }, [
    accountsQ.data,
    accountsQ.isError,
    accountsQ.isPending,
    guestMode,
    helperLive.loggedIn,
    helperLive.running,
    helperRun.lastHelperRunAtMs,
    helperRun.lastHelperRunYmd,
    kdpRoyaltySource,
    memory.dismissedUntilMs,
    memoryReady,
    opts.enabled,
    opts.latestImportedYmd,
    opts.royaltyScopeReason,
    opts.yesterdayYmd,
    user?.id,
    viewProfileIds,
    viewingCustomer,
  ]);

  const onAction = useCallback(
    (id: RoyaltySetupActionId) => {
      if (id === "later") {
        void dismissRoyaltySetup(Date.now()).then(setMemory);
        return;
      }
      if (id === "chrome") {
        nav.openChrome();
        return;
      }
      if (id === "accounts") {
        nav.openAccounts();
        return;
      }
      setKdpRoyaltySource("extension_ios");
      nav.openHelper();
    },
    [nav, setKdpRoyaltySource],
  );

  useEffect(() => {
    if (plan.kind === "none") return;
    if (memory.askedKinds.includes(plan.kind)) return;
    if (askedRef.current === plan.kind) return;
    askedRef.current = plan.kind;
    presentRoyaltySetupAsk(plan, { onAction });
    void rememberRoyaltySetupAsked(plan.kind).then(setMemory);
  }, [memory.askedKinds, onAction, plan]);

  const shortcut = useMemo(
    () => royaltyCollectionShortcut({ helperOn: isIosHelperEnabled(kdpRoyaltySource), askKind: plan.kind }),
    [kdpRoyaltySource, plan.kind],
  );

  const openCollection = useCallback(() => {
    if (shortcut.dest === "ask" && plan.kind !== "none") {
      presentRoyaltySetupAsk(plan, { onAction });
      return;
    }
    if (shortcut.dest === "helper") {
      nav.openHelper();
      return;
    }
    nav.openSource();
  }, [nav, onAction, plan, shortcut.dest]);

  const ask = plan.kind === "none" ? null : (plan as RoyaltySetupAsk);
  return {
    plan,
    ask,
    onAction,
    openCollection,
    collectionLabel: shortcut.label,
    refetchAccounts: accountsQ.refetch,
  };
}
