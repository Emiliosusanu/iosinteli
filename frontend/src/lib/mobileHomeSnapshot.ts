import AsyncStorage from "@react-native-async-storage/async-storage";
import { acosFromSpendSales, iosRolling7Range, localYmd } from "./acosContract.ts";
import { FINANCIAL_READ_VERSION } from "./financialReadVersion.ts";

export const MOBILE_HOME_SCHEMA_VERSION = 1;
/** Home 7D is a rolling last-seven-days window. Overview Week stays ISO Mon–Sun. */
export const HOME_SEVEN_DAY_CONTRACT = "rolling_7d" as const;
export const MOBILE_HOME_CACHE_PREFIX = "inteliads.mobileHomeSnapshot";

export type MobileMetricPresence =
  | "verified"
  | "verified_zero"
  | "missing"
  | "no_sync";

export type MobileDailyPoint = {
  date: string;
  spend: number | null;
  orders: number | null;
  sales: number | null;
  acos: number | null;
  state: MobileMetricPresence;
};

export type MobileHomeActivity = {
  id: string;
  occurredAt: string;
  source: "manual" | "rules" | "bidbot";
  action: string;
  entityType: string | null;
  entityId: string | null;
  entityLabel: string | null;
  oldValue: string | null;
  newValue: string | null;
  unit: string | null;
  status: string | null;
  route: string;
};

export type MobileHomeSnapshotSource = "nest" | "ads_fallback";

export type MobileHomeSnapshot = {
  schemaVersion: number;
  generatedAt: string;
  dataVersion: string;
  /** Nest is authoritative. Ads fallback is usable but must not invent BidBot/rules. */
  source?: MobileHomeSnapshotSource;
  scope: {
    userId: string;
    profileIds: string[];
    currency: string | null;
    mixedCurrency: boolean;
    timeZone: string;
    localDate: string;
  };
  freshness: {
    adsDataAsOf: string | null;
    lastSuccessfulAdsSync: string | null;
    kdpDataAsOf: string | null;
    generatedAt: string;
    dataVersion: string;
  };
  today: MobileDailyPoint;
  yesterday: MobileDailyPoint;
  sevenDay: {
    start: string;
    end: string;
    spend: number | null;
    orders: number | null;
    sales: number | null;
    acos: number | null;
    state: MobileMetricPresence;
    points: MobileDailyPoint[];
  };
  previousSevenDay: {
    start: string;
    end: string;
    spend: number | null;
    orders: number | null;
    sales: number | null;
    acos: number | null;
    state: MobileMetricPresence;
  };
  automation: {
    rulesEnabled: number | null;
    rulesTotal: number | null;
    lastRunAt: string | null;
    entitiesChanged: number | null;
  };
  bidBot: {
    autoMode: string;
    autoApplyEnabled: false;
    lastRunAt: string | null;
    pendingCount: number | null;
    appliedCount: number | null;
  };
  attention: Array<{ id: string; kind: string; label: string; spend: number | null }>;
  topBooks: Array<{ asin: string; title: string | null; omittedUntrusted: boolean }>;
  recentActivity: MobileHomeActivity[];
  activityModes: Array<"all" | "manual" | "rules" | "bidbot">;
  sync: {
    lastSuccessfulAdsSync: string | null;
    pending: boolean;
  };
};

export type MobileHomeCacheScope = {
  userId: string;
  viewAs: string | null;
  profileIds: string[];
  currency: string | null;
};

type PersistedEnvelope = {
  schemaVersion: number;
  financialReadVersion: string;
  savedAt: string;
  verified: true;
  snapshot: MobileHomeSnapshot;
};

const LAST_SCOPE_KEY = `${MOBILE_HOME_CACHE_PREFIX}.lastScope.v${MOBILE_HOME_SCHEMA_VERSION}`;
const memorySnapshots = new Map<string, MobileHomeSnapshot>();

export function peekMobileHomeSnapshot(scope: MobileHomeCacheScope): MobileHomeSnapshot | null {
  if (!scope.userId || scope.profileIds.length === 0) return null;
  return memorySnapshots.get(mobileHomeCacheKey(scope)) ?? null;
}

function rememberMobileHomeSnapshot(scope: MobileHomeCacheScope, snapshot: MobileHomeSnapshot) {
  memorySnapshots.set(mobileHomeCacheKey(scope), snapshot);
}

export function mobileHomeCacheKey(scope: MobileHomeCacheScope): string {
  const profiles = [...scope.profileIds].sort().join(",");
  const view = scope.viewAs ?? "self";
  const currency = scope.currency ?? "none";
  return `${MOBILE_HOME_CACHE_PREFIX}.v${MOBILE_HOME_SCHEMA_VERSION}.${FINANCIAL_READ_VERSION}:${scope.userId}:${view}:${profiles}:${currency}`;
}

function profileScopeMatches(snapshotIds: unknown, scopeIds: readonly string[]): boolean {
  if (!Array.isArray(snapshotIds) || snapshotIds.length !== scopeIds.length) return false;
  const expected = [...scopeIds].sort();
  const actual = snapshotIds.filter((id): id is string => typeof id === "string").sort();
  return expected.length === actual.length && expected.every((id, index) => id === actual[index]);
}

export function isUsableMobileHomeSnapshot(
  value: unknown,
  scope: MobileHomeCacheScope,
): value is MobileHomeSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as MobileHomeSnapshot;
  if (snapshot.schemaVersion !== MOBILE_HOME_SCHEMA_VERSION) return false;
  const expectedUser = scope.viewAs ?? scope.userId;
  if (snapshot.scope?.userId !== expectedUser && snapshot.scope?.userId !== scope.userId) {
    return false;
  }
  if (!profileScopeMatches(snapshot.scope?.profileIds, scope.profileIds)) return false;
  return !!snapshot.today?.date && Array.isArray(snapshot.scope?.profileIds);
}

/** Cached Today/7D is only current on the same local calendar day. */
export function isCurrentHomeSnapshot(
  value: unknown,
  scope: MobileHomeCacheScope,
  localDate = localYmd(new Date()),
): value is MobileHomeSnapshot {
  if (!isUsableMobileHomeSnapshot(value, scope)) return false;
  return value.today.date === localDate || value.scope.localDate === localDate;
}

/** Reject stale generatedAt so overnight cache cannot paint as live. */
export const SNAPSHOT_MAX_AGE_MS = 6 * 60 * 60_000;

export function snapshotAgeMs(snapshot: MobileHomeSnapshot, now = Date.now()): number {
  const raw = snapshot.freshness?.generatedAt ?? snapshot.generatedAt;
  const generated = typeof raw === "string" ? Date.parse(raw) : Number.NaN;
  return Number.isFinite(generated) ? Math.max(0, now - generated) : Number.POSITIVE_INFINITY;
}

export function isFreshHomeSnapshot(
  snapshot: MobileHomeSnapshot,
  maxAgeMs = SNAPSHOT_MAX_AGE_MS,
  now = Date.now(),
): boolean {
  return snapshotAgeMs(snapshot, now) <= maxAgeMs;
}

/** Instant-paint cache must match scope, local day, and freshness window. */
export function usableCachedHomeSnapshot(
  value: unknown,
  scope: MobileHomeCacheScope,
  localDate = localYmd(new Date()),
  maxAgeMs = SNAPSHOT_MAX_AGE_MS,
  now = Date.now(),
): value is MobileHomeSnapshot {
  if (!isCurrentHomeSnapshot(value, scope, localDate)) return false;
  return isFreshHomeSnapshot(value, maxAgeMs, now);
}

function dayPoint(
  date: string,
  spend: number,
  orders: number,
  sales: number,
  hasRow: boolean,
): MobileDailyPoint {
  // No campaign_metrics row means Amazon has not reported that day yet — not a verified $0.
  if (!hasRow) {
    return {
      date,
      spend: null,
      orders: null,
      sales: null,
      acos: null,
      state: "missing",
    };
  }
  const state: MobileMetricPresence =
    spend === 0 && orders === 0 && sales === 0 ? "verified_zero" : "verified";
  return {
    date,
    spend,
    orders,
    sales,
    acos: sales > 0 ? acosFromSpendSales(spend, sales) : null,
    state,
  };
}

export function isAdsFallbackSnapshot(snapshot: MobileHomeSnapshot | null | undefined): boolean {
  return snapshot?.source === "ads_fallback";
}

export function stampMobileHomeSource(
  snapshot: MobileHomeSnapshot,
  source: MobileHomeSnapshotSource,
): MobileHomeSnapshot {
  return snapshot.source === source ? snapshot : { ...snapshot, source };
}

function shiftYmd(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const next = new Date(year, month - 1, day + days);
  return localYmd(next);
}

export function buildMobileHomeSnapshotFromAds(input: {
  userId: string;
  profileIds: string[];
  currency: string | null;
  timeZone: string;
  localDate: string;
  rows: Array<{ date?: string | null; spend?: number | null; sales?: number | null; orders?: number | null }>;
  generatedAt?: string;
}): MobileHomeSnapshot {
  const localDate = input.localDate;
  const [year, month, day] = localDate.split("-").map(Number);
  const seven = iosRolling7Range(new Date(year, month - 1, day, 12));
  const byDate = new Map<string, { spend: number; sales: number; orders: number; rows: number }>();
  for (const row of input.rows) {
    const date = String(row.date ?? "").slice(0, 10);
    if (!date) continue;
    const current = byDate.get(date) ?? { spend: 0, sales: 0, orders: 0, rows: 0 };
    current.spend += Number(row.spend) || 0;
    current.sales += Number(row.sales) || 0;
    current.orders += Number(row.orders) || 0;
    current.rows += 1;
    byDate.set(date, current);
  }

  const pointFor = (date: string): MobileDailyPoint => {
    const agg = byDate.get(date);
    return dayPoint(date, agg?.spend ?? 0, agg?.orders ?? 0, agg?.sales ?? 0, (agg?.rows ?? 0) > 0);
  };

  const today = pointFor(localDate);
  const yesterday = pointFor(shiftYmd(localDate, -1));
  const points: MobileDailyPoint[] = [];
  for (let cursor = seven.start; cursor <= seven.end; cursor = shiftYmd(cursor, 1)) {
    points.push(pointFor(cursor));
  }
  const knownPoints = points.filter(
    (point) => point.state === "verified" || point.state === "verified_zero",
  );
  const sevenSpend = knownPoints.reduce((sum, point) => sum + (point.spend ?? 0), 0);
  const sevenSales = knownPoints.reduce((sum, point) => sum + (point.sales ?? 0), 0);
  const sevenOrders = knownPoints.reduce((sum, point) => sum + (point.orders ?? 0), 0);
  const sevenState: MobileMetricPresence =
    knownPoints.length === 0
      ? "missing"
      : sevenSpend === 0 && sevenSales === 0 && sevenOrders === 0
        ? "verified_zero"
        : "verified";
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const maxKnownDate = knownPoints.reduce(
    (latest, point) => (point.date > latest ? point.date : latest),
    "",
  );

  return {
    schemaVersion: MOBILE_HOME_SCHEMA_VERSION,
    generatedAt,
    dataVersion: localDate,
    source: "ads_fallback",
    scope: {
      userId: input.userId,
      profileIds: [...input.profileIds],
      currency: input.currency,
      mixedCurrency: false,
      timeZone: input.timeZone,
      localDate,
    },
    freshness: {
      adsDataAsOf: maxKnownDate || null,
      lastSuccessfulAdsSync: null,
      kdpDataAsOf: null,
      generatedAt,
      dataVersion: localDate,
    },
    today,
    yesterday,
    sevenDay: {
      start: seven.start,
      end: seven.end,
      spend: knownPoints.length === 0 ? null : sevenSpend,
      orders: knownPoints.length === 0 ? null : sevenOrders,
      sales: knownPoints.length === 0 ? null : sevenSales,
      acos: sevenSales > 0 ? acosFromSpendSales(sevenSpend, sevenSales) : null,
      state: sevenState,
      points,
    },
    previousSevenDay: {
      start: shiftYmd(seven.start, -7),
      end: shiftYmd(seven.start, -1),
      spend: null,
      orders: null,
      sales: null,
      acos: null,
      state: "missing",
    },
    // Ads fallback never invents automation/BidBot — UI must treat these as unknown.
    automation: { rulesEnabled: null, rulesTotal: null, lastRunAt: null, entitiesChanged: null },
    bidBot: {
      autoMode: "off",
      autoApplyEnabled: false,
      lastRunAt: null,
      pendingCount: null,
      appliedCount: null,
    },
    attention: [],
    topBooks: [],
    recentActivity: [],
    activityModes: ["all"],
    sync: { lastSuccessfulAdsSync: null, pending: false },
  };
}

export function isPersistedHomeEnvelopeUsable(
  value: unknown,
  scope: MobileHomeCacheScope,
): value is PersistedEnvelope {
  if (!value || typeof value !== "object") return false;
  const envelope = value as PersistedEnvelope;
  if (envelope.schemaVersion !== MOBILE_HOME_SCHEMA_VERSION) return false;
  if (envelope.financialReadVersion !== FINANCIAL_READ_VERSION) return false;
  if (envelope.verified !== true) return false;
  return isUsableMobileHomeSnapshot(envelope.snapshot, scope);
}

export async function loadMobileHomeSnapshot(
  scope: MobileHomeCacheScope,
): Promise<MobileHomeSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(mobileHomeCacheKey(scope));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedEnvelope;
    if (!isPersistedHomeEnvelopeUsable(parsed, scope)) return null;
    rememberMobileHomeSnapshot(scope, parsed.snapshot);
    return parsed.snapshot;
  } catch {
    return null;
  }
}

export async function persistMobileHomeSnapshot(
  scope: MobileHomeCacheScope,
  snapshot: MobileHomeSnapshot,
): Promise<void> {
  if (!isUsableMobileHomeSnapshot(snapshot, scope)) return;
  const envelope: PersistedEnvelope = {
    schemaVersion: MOBILE_HOME_SCHEMA_VERSION,
    financialReadVersion: FINANCIAL_READ_VERSION,
    savedAt: new Date().toISOString(),
    verified: true,
    snapshot,
  };
  rememberMobileHomeSnapshot(scope, snapshot);
  await AsyncStorage.setItem(mobileHomeCacheKey(scope), JSON.stringify(envelope));
  await AsyncStorage.setItem(LAST_SCOPE_KEY, JSON.stringify(scope));
}

export async function loadLastMobileHomeScope(): Promise<MobileHomeCacheScope | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_SCOPE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MobileHomeCacheScope;
    if (!parsed?.userId || !Array.isArray(parsed.profileIds)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function clearMobileHomeSnapshots(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const prefix = `${MOBILE_HOME_CACHE_PREFIX}.`;
    memorySnapshots.clear();
    await Promise.all(
      keys.filter((key) => key.startsWith(prefix)).map((key) => AsyncStorage.removeItem(key)),
    );
  } catch {
    memorySnapshots.clear();
    try {
      await AsyncStorage.removeItem(LAST_SCOPE_KEY);
    } catch {}
  }
}

export function displayMetric(
  point: Pick<MobileDailyPoint, "spend" | "orders" | "sales" | "acos" | "state">,
  field: "spend" | "orders" | "sales" | "acos",
): number | null {
  if (point.state === "missing" || point.state === "no_sync") return null;
  return point[field];
}

export function freshnessCaption(snapshot: MobileHomeSnapshot, failedRefresh: boolean): string {
  const asOf = snapshot.freshness.adsDataAsOf;
  const generated = snapshot.freshness.generatedAt;
  const clock = generated ? generated.slice(11, 16) : null;
  const adsOnly = isAdsFallbackSnapshot(snapshot);
  if (failedRefresh && clock) return `Couldn't refresh · Showing data from ${clock}`;
  if (adsOnly && asOf) return `Ads-only snapshot · as of ${asOf}`;
  if (adsOnly) return "Ads-only snapshot · freshness unknown";
  if (asOf) return `Ads data as of ${asOf}`;
  if (snapshot.freshness.lastSuccessfulAdsSync) {
    return `Last Ads sync ${snapshot.freshness.lastSuccessfulAdsSync.slice(0, 16)}`;
  }
  return "Ads freshness unknown";
}
