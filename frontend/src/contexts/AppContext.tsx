import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from "react";
import { storage } from "@/src/utils/storage";
import { useQuery } from "@tanstack/react-query";
import { fetchAmazonProfiles } from "../lib/queries";
import { AmazonProfile, DateRange } from "../lib/types";
import { rangePresets } from "../lib/format";
import { useAuth } from "./AuthContext";

const STORAGE_KEYS = {
  selectedProfiles: "inteliads.selectedProfiles",
  dateRange: "inteliads.dateRange",
  royaltyRate: "inteliads.royaltyRate",
};

interface AppContextType {
  profiles: AmazonProfile[];
  profilesLoading: boolean;
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
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const { state: authState, user } = useAuth();
  const [selectedProfileIds, setSelectedProfileIdsState] = useState<string[]>([]);
  const [dateRange, setDateRangeState] = useState<DateRange>(rangePresets().last30);
  const [royaltyRate, setRoyaltyRateState] = useState<number>(70);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate persisted values
  useEffect(() => {
    (async () => {
      const [ids, dr, rr] = await Promise.all([
        storage.getItem(STORAGE_KEYS.selectedProfiles, ""),
        storage.getItem(STORAGE_KEYS.dateRange, ""),
        storage.getItem(STORAGE_KEYS.royaltyRate, 70),
      ]);
      if (ids && typeof ids === "string") {
        try {
          const parsed = JSON.parse(ids);
          if (Array.isArray(parsed)) setSelectedProfileIdsState(parsed);
        } catch {}
      }
      if (dr && typeof dr === "string") {
        try {
          const parsed = JSON.parse(dr);
          if (parsed?.start && parsed?.end) setDateRangeState(parsed);
        } catch {}
      }
      if (typeof rr === "number") setRoyaltyRateState(rr);
      setHydrated(true);
    })();
  }, []);

  const { data: profiles = [], isLoading: profilesLoading } = useQuery({
    queryKey: ["amazon-profiles", user?.id ?? "guest"],
    queryFn: fetchAmazonProfiles,
    enabled: authState === "authenticated",
    staleTime: 60_000,
  });

  // Auto-select all profiles on first load when no persisted selection
  useEffect(() => {
    if (!hydrated) return;
    if (profiles.length === 0) return;
    if (selectedProfileIds.length === 0) {
      const all = profiles.map((p) => p.id);
      setSelectedProfileIdsState(all);
      void storage.setItem(STORAGE_KEYS.selectedProfiles, JSON.stringify(all));
    }
  }, [profiles, hydrated, selectedProfileIds.length]);

  const setSelectedProfileIds = useCallback((ids: string[]) => {
    setSelectedProfileIdsState(ids);
    void storage.setItem(STORAGE_KEYS.selectedProfiles, JSON.stringify(ids));
  }, []);

  const toggleProfile = useCallback(
    (id: string) => {
      const next = selectedProfileIds.includes(id)
        ? selectedProfileIds.filter((x) => x !== id)
        : [...selectedProfileIds, id];
      setSelectedProfileIds(next);
    },
    [selectedProfileIds, setSelectedProfileIds],
  );

  const selectAllProfiles = useCallback(() => {
    setSelectedProfileIds(profiles.map((p) => p.id));
  }, [profiles, setSelectedProfileIds]);

  const setDateRange = useCallback((range: DateRange) => {
    setDateRangeState(range);
    void storage.setItem(STORAGE_KEYS.dateRange, JSON.stringify(range));
  }, []);

  const setRoyaltyRate = useCallback((rate: number) => {
    setRoyaltyRateState(rate);
    void storage.setItem(STORAGE_KEYS.royaltyRate, rate);
  }, []);

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

  return (
    <AppContext.Provider
      value={{
        profiles,
        profilesLoading,
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
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
