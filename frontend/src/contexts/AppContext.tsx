import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef } from "react";
import { AppState } from "react-native";
import { storage } from "@/src/utils/storage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ADMIN_FILTER_KEY, fetchAmazonProfiles, fetchUserSettings, saveUserSetting } from "../lib/queries";
import { fetchNestUsers, type NestUser } from "../lib/mutations";
import { hasNestToken, NestApiError } from "../lib/rulesApi";
import { AmazonProfile, DateRange } from "../lib/types";
import { normalizeDateRange, rangePresets } from "../lib/format";
import { useAuth } from "./AuthContext";
import { configureNotifications, runAlertCheck, registerForPushAsync, clearNotificationIdentity } from "../lib/notifications";

const STORAGE_KEYS = {
  selectedProfiles: "inteliads.selectedProfiles",
  dateRange: "inteliads.dateRange",
  royaltyRate: "inteliads.royaltyRate",
  notifications: "inteliads.notifications",
};

export interface NotificationPrefs {
  newOrder: boolean;
  bookAttention: boolean;
  campaignSpend: boolean;
  spendThreshold: number; // % above daily budget that triggers alert
}

const DEFAULT_NOTIFICATIONS: NotificationPrefs = {
  newOrder: true,
  bookAttention: true,
  campaignSpend: true,
  spendThreshold: 25,
};

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
      const [ids, dr, nf, filterUser] = await Promise.all([
        storage.getItem(STORAGE_KEYS.selectedProfiles, ""),
        storage.getItem(STORAGE_KEYS.dateRange, ""),
        storage.getItem(STORAGE_KEYS.notifications, ""),
        storage.getItem(ADMIN_FILTER_KEY, ""),
      ]);
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
            setNotificationsState({ ...DEFAULT_NOTIFICATIONS, ...parsed });
          }
        } catch {}
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
      setNotificationsState((prev) => ({ ...prev, ...nf }));
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
        void runAlertCheck("foreground");
        const push = await registerForPushAsync();
        if (cancelled) return;
        setNotificationRuntime({ ...runtime, pushRegistered: !!push.token });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [hydrated, notifications, user?.id]);

  // Re-run the alert sweep whenever the app returns to the foreground, and keep
  // a lightweight heartbeat running while it stays open so alerts surface even
  // when iOS never wakes the background task. The interval is paused in the
  // background to avoid wasted work.
  useEffect(() => {
    if (!hydrated || !user?.id) return;
    let interval: ReturnType<typeof setInterval> | null = null;
    const stopPolling = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };
    const startPolling = () => {
      if (interval) return;
      interval = setInterval(() => void runAlertCheck("foreground"), 5 * 60_000);
    };
    if (AppState.currentState === "active") startPolling();
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        void runAlertCheck("foreground");
        startPolling();
      } else {
        stopPolling();
      }
    });
    return () => {
      stopPolling();
      sub.remove();
    };
  }, [hydrated, user?.id]);

  // Keep local profile selection aligned with the live Supabase-linked profiles.
  useEffect(() => {
    if (!hydrated) return;
    if (profiles.length === 0) return;
    const availableIds = new Set(profiles.map((p) => p.id));
    const enabledIds = profiles
      .filter((p) => p.is_enabled === true)
      .map((p) => p.id);
    const selectableIds = enabledIds.length > 0 ? new Set(enabledIds) : availableIds;
    const validSelectedProfiles = profiles.filter(
      (profile) => selectedProfileIds.includes(profile.id) && selectableIds.has(profile.id),
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
    void queryClient.invalidateQueries({ queryKey: ["amazon-profiles"] });
  }, [queryClient]);

  const toggleProfile = useCallback(
    (id: string) => {
      if (selectedProfileIds.includes(id)) {
        setSelectedProfileIds(selectedProfileIds.filter((profileId) => profileId !== id));
        return;
      }

      const nextProfile = profiles.find((profile) => profile.id === id);
      const nextCurrency = nextProfile?.currency_code ?? "USD";
      const compatibleIds = selectedProfileIds.filter((profileId) => {
        const profile = profiles.find((candidate) => candidate.id === profileId);
        return (profile?.currency_code ?? "USD") === nextCurrency;
      });
      const next = [...compatibleIds, id];
      setSelectedProfileIds(next);
    },
    [profiles, selectedProfileIds, setSelectedProfileIds],
  );

  const selectAllProfiles = useCallback(() => {
    const selectedProfile = profiles.find((profile) => selectedProfileIds.includes(profile.id));
    const currency = selectedProfile?.currency_code ?? profiles[0]?.currency_code ?? "USD";
    setSelectedProfileIds(
      profiles
        .filter((profile) => (profile.currency_code ?? "USD") === currency)
        .map((profile) => profile.id),
    );
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

  const setNotifications = useCallback((n: NotificationPrefs) => {
    setNotificationsState(n);
    void storage.setItem(STORAGE_KEYS.notifications, JSON.stringify(n));
    if (user?.id) void saveUserSetting(user.id, "notifications", n);
    const wants = n.newOrder || n.bookAttention || n.campaignSpend;
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
