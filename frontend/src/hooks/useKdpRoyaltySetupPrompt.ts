import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useApp } from "@/src/contexts/AppContext";
import { useAuth } from "@/src/contexts/AuthContext";
import { presentRoyaltySetupAsk, useRoyaltySetupNavigation } from "@/src/components/KdpRoyaltySetupCard";
import { fetchKdpAccounts } from "@/src/lib/mutations";
import { getKdpHelperStatus, subscribeKdpHelperStatus } from "@/src/lib/kdp/runtime";
import { isIosHelperEnabled } from "@/src/lib/kdp/source";
import {
  planKdpRoyaltySetup,
  kdpImporterEvidence,
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
import type { KnownFlag } from "@/src/lib/setupState";
import { royaltySetupPromptGate } from "@/src/lib/royaltySetupPromptGate";

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
  const [memoryUserId, setMemoryUserId] = useState<string | null>(null);
  const ownerRef = useRef(user?.id);
  ownerRef.current = user?.id;
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
    setMemoryReady(false);
    askedRef.current = null;
    void loadRoyaltySetupMemory(user?.id).then((nextMemory) => {
      if (cancelled) return;
      setMemory(nextMemory);
      setMemoryUserId(user?.id ?? null);
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
    if (!opts.enabled || !memoryReady || memoryUserId !== user?.id) return { kind: "none" };
    return planKdpRoyaltySetup({
      guest: guestMode || !user?.id,
      viewingCustomer,
      loading: accountsQ.isPending && accountsQ.data === undefined,
      accountsError: accountsQ.isError && accountsQ.data === undefined,
      royaltyScopeReason: opts.royaltyScopeReason,
      source: kdpRoyaltySource,
      helperLoggedIn: helperLive.loggedIn,
      helperSavedSession: helperLive.savedSession,
      helperRunning: helperLive.running,
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
    helperLive.savedSession,
    helperLive.running,
    kdpRoyaltySource,
    memory.dismissedUntilMs,
    memoryReady,
    memoryUserId,
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
      if (ownerRef.current !== user?.id) return;
      if (id === "later") {
        const owner = user?.id;
        void dismissRoyaltySetup(Date.now(), owner).then((next) => {
          if (ownerRef.current === owner) setMemory(next);
        });
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
    [nav, setKdpRoyaltySource, user?.id],
  );

  useEffect(() => {
    if (plan.kind === "none") return;
    if (memory.askedKinds.includes(plan.kind)) return;
    // At most one automatic ask per foreground visit. Choosing the helper
    // must navigate there, rather than queue its next setup-state alert.
    if (askedRef.current !== null) return;
    const release = royaltySetupPromptGate.acquire(user?.id, plan.kind);
    if (!release) return;
    askedRef.current = plan.kind;
    presentRoyaltySetupAsk(plan, { onAction: (id) => { release(); onAction(id); } });
    const owner = user?.id;
    void rememberRoyaltySetupAsked(plan.kind, owner).then((next) => {
      if (ownerRef.current === owner) setMemory(next);
    });
  }, [memory.askedKinds, onAction, plan, user?.id]);

  const shortcut = useMemo(
    () => royaltyCollectionShortcut({ helperOn: isIosHelperEnabled(kdpRoyaltySource), askKind: plan.kind }),
    [kdpRoyaltySource, plan.kind],
  );

  const openCollection = useCallback(() => {
    if (shortcut.dest === "ask" && plan.kind !== "none") {
      const release = royaltySetupPromptGate.acquire(user?.id, plan.kind, false);
      if (release) presentRoyaltySetupAsk(plan, { onAction: (id) => { release(); onAction(id); } });
      return;
    }
    if (shortcut.dest === "helper") {
      nav.openHelper();
      return;
    }
    nav.openSource();
  }, [nav, onAction, plan, shortcut.dest, user?.id]);

  const ask = plan.kind === "none" ? null : (plan as RoyaltySetupAsk);
  const kdpAccountLinked: KnownFlag =
    accountsQ.data !== undefined
      ? accountsQ.data.length > 0
      : accountsQ.isPending || accountsQ.isError
        ? "unknown"
        : false;
  const kdpImporterActive: KnownFlag = kdpImporterEvidence({
    accounts: accountsQ.data,
    accountsUnavailable: accountsQ.data === undefined,
    latestImportedYmd: opts.latestImportedYmd,
    yesterdayYmd: opts.yesterdayYmd,
    nowMs: Date.now(),
  });
  return {
    plan,
    ask,
    onAction,
    openCollection,
    collectionLabel: shortcut.label,
    refetchAccounts: accountsQ.refetch,
    kdpAccountLinked,
    kdpImporterActive,
  };
}
