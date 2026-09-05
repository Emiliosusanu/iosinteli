import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Alert, AppState } from "react-native";
import { storage } from "@/src/utils/storage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ADMIN_FILTER_KEY, fetchAmazonProfiles, fetchUserSettings, saveUserSetting } from "../lib/queries";
import { fetchNestUsers, type NestUser } from "../lib/mutations";
import { hasNestToken, NestApiError } from "../lib/rulesApi";
import { AmazonProfile, DateRange } from "../lib/types";
import { normalizeDateRange, rangePresets } from "../lib/format";
import { useAuth } from "./AuthContext";
import { configureNotifications, registerForPushAsync, clearNotificationIdentity, installBackgroundSyncWakeHandlers, runAlertCheck, subscribeNotificationRefresh } from "../lib/notifications";
import { DEFAULT_KDP_ROYALTY_SOURCE, normalizeKdpRoyaltySource, type KdpRoyaltySource } from "../lib/kdp/source";
import { getKdpRoyaltySource, setKdpRoyaltySource as persistKdpRoyaltySource } from "../lib/kdp/sourceStore";
import {
  NEST_DISABLED_VIEW_MESSAGE,
  NEST_DISABLED_VIEW_TITLE,
  VIEW_CURRENCY_CONFLICT_TITLE,
  planSelectAllSameCurrency,
  planViewToggle,
  viewCurrencyConflictMessage,
} from "../lib/accountsUi";

const STORAGE_KEYS = {
  selectedProfiles: "inteliads.selectedProfiles",
  dateRange: "inteliads.dateRange",
  royaltyRate: "inteliads.royaltyRate",
  notifications: "inteliads.notifications",
  /** One-shot: flip mass-safe all-off installs to the current ON defaults. */
  notificationsEnabledBundle: "inteliads.notifications.enabledBundle.v1",
};

export interface NotificationPrefs {
  newOrder: boolean;
  bookAttention: boolean;
  campaignSpend: boolean;
  spendThreshold: number;
  dailyDigest: boolean;
  includeKdpNet: boolean;
}

/** Mass-use defaults: alerts ON; Nest owns morning digest + new orders when synced. */
const DEFAULT_NOTIFICATIONS: NotificationPrefs = {
  newOrder: true,
  bookAttention: true,
  campaignSpend: true,
  spendThreshold: 25,
  dailyDigest: true,
  includeKdpNet: true,
};

/** Map Nest `dailyReport` onto the iOS `dailyDigest` switch so remote prefs stay honest. */
function coalesceNotificationPrefs(
  raw: Record<string, unknown>,
  base: NotificationPrefs = DEFAULT_NOTIFICATIONS,
): NotificationPrefs {
  const dailyDigest =
    typeof raw.dailyDigest === "boolean"
      ? raw.dailyDigest
      : typeof raw.dailyReport === "boolean"
        ? raw.dailyReport
        : base.dailyDigest;
  return {
    newOrder: typeof raw.newOrder === "boolean" ? raw.newOrder : base.newOrder,
    bookAttention: typeof raw.bookAttention === "boolean" ? raw.bookAttention : base.bookAttention,
    campaignSpend: typeof raw.campaignSpend === "boolean" ? raw.campaignSpend : base.campaignSpend,
    spendThreshold:
      typeof raw.spendThreshold === "number" && Number.isFinite(raw.spendThreshold)
        ? raw.spendThreshold
        : base.spendThreshold,
    dailyDigest,
    includeKdpNet: typeof raw.includeKdpNet === "boolean" ? raw.includeKdpNet : base.includeKdpNet,
  };
}

interface AppContextType {
  profiles: AmazonProfile[];
  profilesLoading: boolean;
  profilesFetching: boolean;
  profilesError: boolean;
  refetchProfiles: () => void;
  adminUsers: NestUser[];
  adminUsersLoading: boolean;
  adminUsersError: boolean;
  isAdminViewer: boolean;
  adminFilterUserId: string | null;
  setAdminFilterUserId: (id: string | null) => void;
  selectedProfileIds: string[];
  setSelectedProfileIds: (ids: string[]) => void;
  toggleProfile: (id: string) => void;
  selectAllProfiles: () => void;
  selectedProfiles: AmazonProfile[];
  primaryCurrency: string;
  dateRange: DateRange;
  setDateRange: (range: DateRange) => void;
  royaltyRate: number;
  setRoyaltyRate: (rate: number) => void;
  kdpRoyaltySource: KdpRoyaltySource;
  setKdpRoyaltySource: (source: KdpRoyaltySource) => void;
  notifications: NotificationPrefs;
  setNotifications: (n: NotificationPrefs) => void;
  notificationRuntime: {
    permission: "granted" | "denied" | "undetermined";
    backgroundRegistered: boolean;
    pushRegistered: boolean;
  };
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const { state: authState, user, guestMode } = useAuth();
  const [selectedProfileIds, setSelectedProfileIdsState] = useState<string[]>([]);
  const [adminFilterUserId, setAdminFilterUserIdState] = useState<string | null>(null);
  const [dateRange, setDateRangeState] = useState<DateRange>(rangePresets().thisMonth);
  const [royaltyRate, setRoyaltyRateState] = useState<number>(0);
  const [kdpRoyaltySource, setKdpRoyaltySourceState] = useState<KdpRoyaltySource>(DEFAULT_KDP_ROYALTY_SOURCE);
  const [notifications, setNotificationsState] = useState<NotificationPrefs>(DEFAULT_NOTIFICATIONS);
  const [notificationRuntime, setNotificationRuntime] = useState({
    permission: "undetermined" as "granted" | "denied" | "undetermined",
    backgroundRegistered: false,
    pushRegistered: false,
  });
  const [hydrated, setHydrated] = useState(false);
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  // Hydrate persisted values
  useEffect(() => {
    (async () => {
      const [ids, dr, nf, filterUser, kdpSource] = await Promise.all([
        storage.getItem(STORAGE_KEYS.selectedProfiles, ""),
        storage.getItem(STORAGE_KEYS.dateRange, ""),
        storage.getItem(STORAGE_KEYS.notifications, ""),
        storage.getItem(ADMIN_FILTER_KEY, ""),
        getKdpRoyaltySource(),
      ]);
      setKdpRoyaltySourceState(normalizeKdpRoyaltySource(kdpSource));
      if (typeof filterUser === "string" && filterUser.length > 0) {
        setAdminFilterUserIdState(filterUser);
      }
      if (ids && typeof ids === "string") {
        try {
          const parsed = JSON.parse(ids);
          if (Array.isArray(parsed)) setSelectedProfileIdsState(parsed);
        } catch {}
      }
      if (dr && typeof dr === "string") {
        try {
          const parsed = JSON.parse(dr);
          if (parsed?.start && parsed?.end) {
            const normalized = normalizeDateRange(parsed);
            setDateRangeState(normalized);
            void storage.setItem(STORAGE_KEYS.dateRange, JSON.stringify(normalized));
          }
        } catch {}
      }
      if (nf && typeof nf === "string") {
        try {
          const parsed = JSON.parse(nf);
          if (parsed && typeof parsed === "object") {
            const bundle = await storage.getItem(STORAGE_KEYS.notificationsEnabledBundle, "");
            if (!bundle) {
              // Prior mass-safe default was all-off; enable the full alert set once.
              setNotificationsState(DEFAULT_NOTIFICATIONS);
              void storage.setItem(STORAGE_KEYS.notifications, JSON.stringify(DEFAULT_NOTIFICATIONS));
              void storage.setItem(STORAGE_KEYS.notificationsEnabledBundle, "1");
            } else {
              setNotificationsState(coalesceNotificationPrefs(parsed as Record<string, unknown>));
            }
          }
        } catch {}
      } else {
        void storage.setItem(STORAGE_KEYS.notificationsEnabledBundle, "1");
      }
      setHydrated(true);
    })();
  }, []);

  // Clear persisted profile selection when the signed-in user changes so one
  // account never sees data scoped to a different account's profile IDs.
  useEffect(() => {
    if (!hydrated) return;
    const prevId = prevUserIdRef.current;
    const currId = user?.id ?? null;
    if (prevId !== undefined && prevId !== currId) {
      setSelectedProfileIdsState([]);
      setAdminFilterUserIdState(null);
      setNotificationsState(DEFAULT_NOTIFICATIONS);
      void storage.setItem(STORAGE_KEYS.selectedProfiles, JSON.stringify([]));
      void storage.setItem(STORAGE_KEYS.notifications, JSON.stringify(DEFAULT_NOTIFICATIONS));
      void storage.removeItem(ADMIN_FILTER_KEY);
      void clearNotificationIdentity();
    }
    prevUserIdRef.current = currId;
  }, [user?.id, hydrated]);

  const { data: nestReady = false, isFetched: nestTokenFetched } = useQuery({
    queryKey: ["nest-token", user?.id ?? "guest"],
    queryFn: hasNestToken,
    enabled: !!user?.id && authState === "authenticated" && !guestMode,
    staleTime: 15_000,
  });

  const adminUsersQuery = useQuery({
    queryKey: ["admin-users", user?.id],
    queryFn: fetchNestUsers,
    enabled: !!user?.id && authState === "authenticated" && !guestMode && nestReady,
    retry: false,
    staleTime: 5 * 60_000,
  });
  const adminUsers = adminUsersQuery.data ?? [];
  const isAdminViewer = adminUsersQuery.isSuccess || !!adminFilterUserId;

  const customers = useMemo(
    () => adminUsers.filter((candidate) => !candidate.isAdmin && candidate.id !== user?.id),
    [adminUsers, user?.id],
  );

  useEffect(() => {
    if (!hydrated || !adminUsersQuery.isSuccess) return;
    if (customers.length === 0) return;
    if (adminFilterUserId && customers.some((candidate) => candidate.id === adminFilterUserId)) return;
    setAdminFilterUserIdState(customers[0].id);
    void storage.setItem(ADMIN_FILTER_KEY, customers[0].id);
  }, [hydrated, adminUsersQuery.isSuccess, customers, adminFilterUserId]);

  useEffect(() => {
    const error = adminUsersQuery.error;
    if (!(error instanceof NestApiError) || (error.status !== 401 && error.status !== 403)) return;
    if (!adminFilterUserId) return;
    setAdminFilterUserIdState(null);
    void storage.removeItem(ADMIN_FILTER_KEY);
  }, [adminUsersQuery.error, adminFilterUserId]);

  const waitingForCustomer =
    !!user?.id &&
    !guestMode &&
    nestReady &&
    !adminFilterUserId &&
    !adminUsersQuery.isFetched;

  const {
    data: profiles = [],
    isLoading: profilesLoading,
    isFetching: profilesFetching,
    isError: profilesError,
    refetch: refetchProfiles,
  } = useQuery({
    queryKey: ["amazon-profiles", user?.id ?? "guest", adminFilterUserId ?? "self"],
    queryFn: () => fetchAmazonProfiles(user?.id, isAdminViewer ? adminFilterUserId : null),
    enabled: authState === "authenticated" && hydrated && !waitingForCustomer && (guestMode || nestTokenFetched),
    staleTime: 60_000,
    refetchOnMount: "always",
  });

  // Load persisted settings from user_settings table (read-only, cross-device)
  const { data: remoteSettings } = useQuery({
    queryKey: ["user-settings", user?.id],
    queryFn: () => fetchUserSettings(user!.id),
    enabled: !!user?.id && hydrated,
    staleTime: 300_000,
  });

  // Apply remote settings — Supabase values override AsyncStorage defaults
  useEffect(() => {
    if (!remoteSettings) return;
    const rr =
      remoteSettings["royaltyRate"] ??
      remoteSettings["royalty_rate"] ??
      remoteSettings["breakEvenAcos"] ??
      remoteSettings["break_even_acos"] ??
      remoteSettings["targetAcos"] ??
      remoteSettings["target_acos"];
    const rate = Number(rr);
    if (Number.isFinite(rate) && rate > 0 && rate <= 100) setRoyaltyRateState(rate);
    const nf = remoteSettings["notifications"];
    if (nf && typeof nf === "object") {
      setNotificationsState((prev) =>
        coalesceNotificationPrefs(nf as Record<string, unknown>, prev),
      );
    }
  }, [remoteSettings]);

  useEffect(() => {
    if (!hydrated || !user?.id) return;
    let cancelled = false;
    configureNotifications(notifications, { requestPermission: false })
      .then(async (runtime) => {
        if (cancelled) return;
        setNotificationRuntime({ ...runtime, pushRegistered: false });
        if (runtime.permission !== "granted") return;
        const push = await registerForPushAsync();
        if (cancelled) return;
        setNotificationRuntime({ ...runtime, pushRegistered: !!push.token });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [hydrated, notifications, user?.id]);

  useEffect(() => {
    installBackgroundSyncWakeHandlers();
  }, []);

  // A push just landed: repaint any open financial/Ads screens immediately
  // instead of waiting for the query to go stale (~45s).
  useEffect(() => {
    const unsub = subscribeNotificationRefresh(() => {
      void import("../lib/backgroundFinancialSync").then(({ backgroundFinancialQueryRoots }) => {
        const roots = backgroundFinancialQueryRoots();
        const adsPrefixes = [
          "mobile-overview",
          "top-campaigns",
          "campaigns-list",
          "campaign-metrics",
          "top-books",
          "products-range",
        ];
        void queryClient.invalidateQueries({
          predicate: (query) => {
            const key = query.queryKey[0];
            if (typeof key !== "string") return false;
            return roots.includes(key) || adsPrefixes.some((prefix) => key.startsWith(prefix));
          },
          refetchType: "active",
        });
      });
    });
    return () => unsub();
  }, [queryClient]);

  useEffect(() => {
    let unsub = () => {};
    void import("../lib/bulkOutbox").then(({ subscribeBulkOutboxDrain }) => {
      unsub = subscribeBulkOutboxDrain((result) => {
        if (result.succeeded <= 0 && result.failedPermanent <= 0 && !(result.failedItems?.length)) return;

        // Permanent Amazon rejects must undo optimistic bids/state — never leave a fake value painted.
        if (result.failedItems?.length) {
          void import("../lib/invalidateAds").then(({ revertOptimisticEntityBid, revertOptimisticEntityState }) => {
            for (const item of result.failedItems) {
              if (item.action === "set_bid" || item.action === "bid_delta") {
                if (item.entityKind === "keyword" || item.entityKind === "product_target") {
                  revertOptimisticEntityBid(
                    queryClient,
                    item.entityKind,
                    item.entityId,
                    item.previousBid ?? null,
                  );
                }
              } else if (item.action === "pause" || item.action === "enable") {
                if (item.previousEnabled != null) {
                  const kind =
                    item.entityKind === "keyword"
                      ? "keyword"
                      : item.entityKind === "product_target"
                        ? "product_target"
                        : "campaign";
                  revertOptimisticEntityState(queryClient, kind, item.entityId, item.previousEnabled);
                }
              }
            }
          });
          const n = result.failedItems.length;
          const detail = result.failedItems[0]?.lastError?.trim();
          const restoredAny = result.failedItems.some(
            (item) =>
              ((item.action === "set_bid" || item.action === "bid_delta") &&
                item.previousBid != null &&
                Number.isFinite(Number(item.previousBid))) ||
              ((item.action === "pause" || item.action === "enable") && item.previousEnabled != null),
          );
          void import("../lib/bulkOutboxContract").then(
            ({ bulkFailureAlertBody, bulkFailureAlertTitle, classifyBulkFailureSource }) => {
              const sources = result.failedItems.map((item) =>
                classifyBulkFailureSource(item.lastError),
              );
              const dominant =
                sources.every((s) => s === "stale_or_unowned")
                  ? "stale_or_unowned"
                  : sources.every((s) => s === "amazon")
                    ? "amazon"
                    : sources.includes("stale_or_unowned") && !sources.includes("amazon")
                      ? "stale_or_unowned"
                      : sources.includes("amazon") && !sources.includes("stale_or_unowned")
                        ? "amazon"
                        : "other";
              // Amazon rejected / Nest not-found titles come from bulkFailureAlertTitle.
              Alert.alert(
                bulkFailureAlertTitle(n, dominant),
                bulkFailureAlertBody({ detail, source: dominant, restoredAny }),
              );
            },
          );
        }

        void queryClient.invalidateQueries({
          predicate: (query) => {
            const key = query.queryKey[0];
            return (
              typeof key === "string" &&
              (key.startsWith("targeting-") ||
                key.startsWith("campaign") ||
                key.startsWith("keyword") ||
                key.startsWith("product-target") ||
                key.startsWith("ad-group") ||
                key === "ad-groups")
            );
          },
          refetchType: "active",
        });
      });
    });
    return () => unsub();
  }, [queryClient]);

  // Resume: dual-source refresh (Ads API + linked KDP from cloud), evaluate local
  // alerts, and invalidate active financial reads so cache paints fast overnight.
  useEffect(() => {
    if (!hydrated || !user?.id) return;
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "background") {
        void import("../lib/bulkOutbox").then(({ drainBulkOutbox }) => drainBulkOutbox());
        void import("../lib/kdp/importer").then(({ runKdpIosHelperTick }) =>
          runKdpIosHelperTick("background", { profileIds: selectedProfileIds }),
        );
        return;
      }
      if (next === "inactive") {
        void import("../lib/bulkOutbox").then(({ drainBulkOutbox }) => drainBulkOutbox());
        return;
      }
      if (next === "active") {
        void (async () => {
          const { runDualSourceBackgroundRefresh, backgroundFinancialQueryRoots } = await import(
            "../lib/backgroundFinancialSync"
          );
          await runDualSourceBackgroundRefresh("foreground", { force: true });
          const { runKdpIosHelperTick } = await import("../lib/kdp/importer");
          await runKdpIosHelperTick("foreground", { profileIds: selectedProfileIds });
          void runAlertCheck("foreground");
          const { drainBulkOutbox } = await import("../lib/bulkOutbox");
          void drainBulkOutbox();
          // Nest durable bulk jobs continue server-side while the app is closed —
          // poll on resume so optimistic paint can revert permanent fails.
          void import("../lib/nestBulkJobs").then(async ({ refreshOpenNestBulkJobs }) => {
            try {
              const { newlyCompleted } = await refreshOpenNestBulkJobs();
              if (!newlyCompleted.length) return;
              const { revertOptimisticEntityBid, revertOptimisticEntityState } = await import(
                "../lib/invalidateAds"
              );
              const {
                bulkFailureAlertBody,
                bulkFailureAlertTitle,
                canRestoreBulkRevertItem,
                classifyBulkFailureSource,
                nestBulkConfirmedSucceeded,
                nestBulkRevertPlan,
                nestBulkSkipAlert,
                shouldRevertNestBulkEntity,
              } = await import("../lib/bulkOutboxContract");
              for (const done of newlyCompleted) {
                const plan = nestBulkRevertPlan({
                  failedIds: done.failedIds,
                  permanentFailIds: done.permanentFailIds,
                  skippedIds: done.skippedIds,
                  resultFailed: done.resultFailed,
                  resultSucceeded: done.resultSucceeded,
                  resultSkipped: done.resultSkipped,
                });
                let restoredAny = false;
                for (const revert of done.revertItems || []) {
                  if (!shouldRevertNestBulkEntity(revert.entityId, plan)) continue;
                  if (!canRestoreBulkRevertItem(revert)) continue;
                  if (revert.action === "pause" || revert.action === "enable") {
                    revertOptimisticEntityState(
                      queryClient,
                      done.entityKind,
                      revert.entityId,
                      revert.previousEnabled as boolean,
                    );
                    restoredAny = true;
                  } else {
                    revertOptimisticEntityBid(
                      queryClient,
                      done.entityKind,
                      revert.entityId,
                      revert.previousBid ?? null,
                    );
                    restoredAny = true;
                  }
                }
                const failCount =
                  done.failedIds?.length ||
                  done.permanentFailIds?.length ||
                  done.resultFailed ||
                  0;
                if (failCount > 0) {
                  const detail = done.permanentMessages?.[0] || done.lastError || null;
                  const sources = (done.permanentMessages || [detail]).map((m) =>
                    classifyBulkFailureSource(m),
                  );
                  const dominant =
                    sources.every((s) => s === "stale_or_unowned")
                      ? "stale_or_unowned"
                      : sources.every((s) => s === "amazon")
                        ? "amazon"
                        : sources.includes("stale_or_unowned") && !sources.includes("amazon")
                          ? "stale_or_unowned"
                          : sources.includes("amazon") && !sources.includes("stale_or_unowned")
                            ? "amazon"
                            : "other";
                  Alert.alert(
                    bulkFailureAlertTitle(failCount, dominant),
                    bulkFailureAlertBody({
                      detail,
                      source: dominant,
                      restoredAny,
                    }),
                  );
                } else if ((done.resultSkipped ?? done.skippedIds?.length ?? 0) > 0) {
                  const skipAlert = nestBulkSkipAlert({
                    succeeded: nestBulkConfirmedSucceeded({
                      succeeded: done.resultSucceeded,
                    }),
                    skipped: done.resultSkipped ?? done.skippedIds?.length ?? 0,
                    restoredAny,
                  });
                  Alert.alert(skipAlert.title, skipAlert.body);
                }
              }
            } catch {
              // Resume polling is best-effort; Targets screen also refreshes.
            }
          });
          void queryClient.invalidateQueries({
            predicate: (query) => {
              const key = query.queryKey[0];
              return typeof key === "string" && backgroundFinancialQueryRoots().includes(key);
            },
            refetchType: "active",
          });
        })();
      }
    });
    return () => sub.remove();
  }, [hydrated, queryClient, user?.id, selectedProfileIds]);

  // Always register the ~15m BG metronome when signed in (Ads refresh + KDP wakes).
  // The JS interval only ticks the iPhone KDP helper while that source is selected.
  useEffect(() => {
    if (!hydrated || !user?.id) return;
    void import("../lib/notifications").then(async (m) => {
      await m.ensureBackgroundRefreshRegistered();
      // Silent KDP / server pushes need a live APNs token.
      await m.registerForPushAsync({ requestPermission: true });
    });
    if (kdpRoyaltySource !== "extension_ios") return;
    const id = setInterval(() => {
      void import("../lib/kdp/importer").then((m) =>
        m.runKdpIosHelperTick("interval", { profileIds: selectedProfileIds }),
      );
    }, 15 * 60_000);
    return () => clearInterval(id);
  }, [hydrated, user?.id, kdpRoyaltySource, selectedProfileIds]);

  // Keep local profile selection aligned with the live Supabase-linked profiles.
  useEffect(() => {
    if (!hydrated) return;
    if (profiles.length === 0) return;
    const availableIds = new Set(profiles.map((p) => p.id));
    const enabledIds = profiles
      .filter((p) => p.is_enabled !== false)
      .map((p) => p.id);
    const selectableIds = enabledIds.length > 0 ? new Set(enabledIds) : availableIds;
    const validSelectedProfiles = profiles.filter(
      (profile) =>
        (selectedProfileIds.includes(profile.id) || selectedProfileIds.includes(profile.profile_id)) &&
        selectableIds.has(profile.id),
    );
    const selectedCurrency = validSelectedProfiles[0]?.currency_code ?? "USD";
    const validSelectedIds = validSelectedProfiles
      .filter((profile) => (profile.currency_code ?? "USD") === selectedCurrency)
      .map((profile) => profile.id);
    const dataBackedIds = profiles
      .filter((p) => (p.campaign_count ?? 0) > 0 || (p.kdp_account_count ?? 0) > 0)
      .map((p) => p.id);
    const defaultCandidateIds = enabledIds.length > 0
      ? enabledIds
      : dataBackedIds.length > 0
        ? dataBackedIds
        : profiles.map((profile) => profile.id);
    const defaultCandidates = profiles.filter((profile) => defaultCandidateIds.includes(profile.id));
    const defaultCurrency = defaultCandidates[0]?.currency_code ?? "USD";
    const defaultIds = defaultCandidates
      .filter((profile) => (profile.currency_code ?? "USD") === defaultCurrency)
      .map((profile) => profile.id);
    const nextIds = validSelectedIds.length > 0 ? validSelectedIds : defaultIds;
    const changed =
      nextIds.length !== selectedProfileIds.length ||
      nextIds.some((id, index) => id !== selectedProfileIds[index]);

    if (changed) {
      setSelectedProfileIdsState(nextIds);
      void storage.setItem(STORAGE_KEYS.selectedProfiles, JSON.stringify(nextIds));
    }
  }, [profiles, hydrated, selectedProfileIds]);

  const setSelectedProfileIds = useCallback((ids: string[]) => {
    setSelectedProfileIdsState(ids);
    void storage.setItem(STORAGE_KEYS.selectedProfiles, JSON.stringify(ids));
  }, []);

  const setAdminFilterUserId = useCallback((id: string | null) => {
    setAdminFilterUserIdState(id);
    if (id) void storage.setItem(ADMIN_FILTER_KEY, id);
    else void storage.removeItem(ADMIN_FILTER_KEY);
    setSelectedProfileIdsState([]);
    void storage.setItem(STORAGE_KEYS.selectedProfiles, JSON.stringify([]));
    // Drop customer-scoped finance/list caches so the next customer never
    // briefly inherits the previous one's entities or period totals.
    void queryClient.invalidateQueries({ queryKey: ["amazon-profiles"] });
    void queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey[0];
        return (
          typeof key === "string" &&
          (key.startsWith("campaign") ||
            key.startsWith("targeting-") ||
            key.startsWith("top-") ||
            key.startsWith("products") ||
            key.startsWith("kdp-") ||
            key.startsWith("mobile-overview") ||
            key.startsWith("placement-") ||
            key.startsWith("search-terms") ||
            key.startsWith("bleeding-") ||
            key.startsWith("overview-") ||
            key.startsWith("hourly-") ||
            key.startsWith("rule-") ||
            key === "optimization-rules" ||
            key === "all-campaign-budgets" ||
            key === "sync-logs" ||
            key === "today-execution-stats")
        );
      },
    });
  }, [queryClient]);

  const toggleProfile = useCallback(
    (id: string) => {
      const plan = planViewToggle({
        profileId: id,
        profiles,
        selectedProfileIds,
      });

      if (plan.kind === "remove" || plan.kind === "add") {
        setSelectedProfileIds(plan.nextIds);
        return;
      }

      if (plan.kind === "nest_disabled") {
        Alert.alert(NEST_DISABLED_VIEW_TITLE, NEST_DISABLED_VIEW_MESSAGE);
        return;
      }

      Alert.alert(
        VIEW_CURRENCY_CONFLICT_TITLE,
        viewCurrencyConflictMessage(plan.currentCurrency, plan.nextCurrency),
        [
          { text: "Cancel", style: "cancel" },
          {
            text: `Switch to ${plan.nextCurrency}`,
            onPress: () => setSelectedProfileIds(plan.nextIdsIfSwitch),
          },
        ],
      );
    },
    [profiles, selectedProfileIds, setSelectedProfileIds],
  );

  const selectAllProfiles = useCallback(() => {
    const next =
      typeof planSelectAllSameCurrency === "function"
        ? planSelectAllSameCurrency({ profiles, selectedProfileIds })
        : profiles
            .filter((profile) => profile.is_enabled !== false)
            .filter((profile, _, list) => {
              const currency =
                list.find((row) => selectedProfileIds.includes(row.id) || selectedProfileIds.includes(row.profile_id))
                  ?.currency_code ??
                list[0]?.currency_code;
              return (profile.currency_code ?? "USD") === (currency ?? "USD");
            })
            .map((profile) => profile.id);
    setSelectedProfileIds(next);
  }, [profiles, selectedProfileIds, setSelectedProfileIds]);

  const setDateRange = useCallback((range: DateRange) => {
    const normalized = normalizeDateRange(range);
    setDateRangeState(normalized);
    void storage.setItem(STORAGE_KEYS.dateRange, JSON.stringify(normalized));
  }, []);

  const setRoyaltyRate = useCallback((rate: number) => {
    setRoyaltyRateState(rate);
    void storage.setItem(STORAGE_KEYS.royaltyRate, rate);
  }, []);

  const setKdpRoyaltySource = useCallback((source: KdpRoyaltySource) => {
    const next = normalizeKdpRoyaltySource(source);
    setKdpRoyaltySourceState(next);
    void persistKdpRoyaltySource(next);
    // Enabling the iPhone helper kicks onboarding immediately; disabling stops it.
    void import("../lib/kdp/importer")
      .then((m) => m.onKdpRoyaltySourceChanged(next))
      .catch(() => {});
  }, []);

  const setNotifications = useCallback((n: NotificationPrefs) => {
    setNotificationsState(n);
    void storage.setItem(STORAGE_KEYS.notifications, JSON.stringify(n));
    if (user?.id) void saveUserSetting(user.id, "notifications", n);
    const wants = n.newOrder || n.bookAttention || n.campaignSpend || n.dailyDigest;
    void configureNotifications(n, { requestPermission: wants });
  }, [user?.id]);

  const selectedProfiles = useMemo(
    () => profiles.filter((p) => selectedProfileIds.includes(p.id)),
    [profiles, selectedProfileIds],
  );

  // Determine primary currency (most common amongst selected)
  const primaryCurrency = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of selectedProfiles) {
      const c = p.currency_code ?? "USD";
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    let max = 0;
    let cur = "USD";
    for (const [k, v] of counts.entries()) {
      if (v > max) {
        max = v;
        cur = k;
      }
    }
    return cur;
  }, [selectedProfiles]);

  const scopeLoading = profilesLoading || waitingForCustomer || (!!user && !guestMode && !nestTokenFetched);

  const value = useMemo(
    () => ({
      profiles,
      profilesLoading: scopeLoading,
      profilesFetching,
      profilesError,
      refetchProfiles,
      adminUsers,
      adminUsersLoading: adminUsersQuery.isLoading || waitingForCustomer,
      adminUsersError:
        adminUsersQuery.isError &&
        !(adminUsersQuery.error instanceof NestApiError &&
          (adminUsersQuery.error.status === 401 || adminUsersQuery.error.status === 403)),
      isAdminViewer,
      adminFilterUserId,
      setAdminFilterUserId,
      selectedProfileIds,
      setSelectedProfileIds,
      toggleProfile,
      selectAllProfiles,
      selectedProfiles,
      primaryCurrency,
      dateRange,
      setDateRange,
      royaltyRate,
      setRoyaltyRate,
      kdpRoyaltySource,
      setKdpRoyaltySource,
      notifications,
      setNotifications,
      notificationRuntime,
    }),
    [
      profiles,
      scopeLoading,
      profilesFetching,
      profilesError,
      refetchProfiles,
      adminUsers,
      adminUsersQuery.isLoading,
      adminUsersQuery.isError,
      adminUsersQuery.error,
      waitingForCustomer,
      isAdminViewer,
      adminFilterUserId,
      setAdminFilterUserId,
      selectedProfileIds,
      setSelectedProfileIds,
      toggleProfile,
      selectAllProfiles,
      selectedProfiles,
      primaryCurrency,
      dateRange,
      setDateRange,
      royaltyRate,
      setRoyaltyRate,
      kdpRoyaltySource,
      setKdpRoyaltySource,
      notifications,
      setNotifications,
      notificationRuntime,
    ],
  );

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
