import { requireOptionalNativeModule, Platform } from "expo-modules-core";

export type NativeSyncStatus = {
  enabled: boolean;
  refreshTaskId: string;
  processingTaskId: string;
  metronomeSeconds: number;
  lastSuccessAtMs: number;
  lastRunAtMs: number;
  lastError: string;
  nextDelaySeconds: number;
  backgroundRefreshStatus: number;
};

export type SyncSnapshotPayload = {
  status: string;
  detail?: string;
  progress?: number | null;
  isActive: boolean;
  completedAtMs?: number | null;
  accountName?: string;
  currencySymbol?: string;
  royalties?: number;
  adSpend?: number;
  net?: number;
  reload?: boolean;
};

export type FinancialWidgetSnapshotPayload = {
  verified: boolean;
  asOfMs?: number | null;
  periodLabel?: string;
  scopeKey?: string;
  currencySymbol?: string;
  royalties?: number;
  adSpend?: number;
  net?: number;
  reload?: boolean;
};

export type NativeWakeKind = "recent" | "processing";
export type ApnsEnvironment = "sandbox" | "production";

type NativeModule = {
  getApnsEnvironmentAsync(): Promise<string>;
  getCookieHeaderAsync(url: string): Promise<string>;
  clearAmazonKdpCookiesAsync(): Promise<number>;
  registerAndScheduleAsync(force: boolean): Promise<boolean>;
  scheduleIfNeededAsync(force: boolean): Promise<boolean>;
  setEnabledAsync(enabled: boolean): Promise<boolean>;
  getStatusAsync(): Promise<NativeSyncStatus>;
  consumePendingWakeKindAsync(): Promise<string | null>;
  updateSyncSnapshotAsync(payload: SyncSnapshotPayload): Promise<boolean>;
  updateFinancialSnapshotAsync(payload: FinancialWidgetSnapshotPayload): Promise<boolean>;
  getSyncSnapshotAsync(): Promise<Record<string, unknown>>;
  getStoreProductsAsync(): Promise<StoreProduct[]>;
  purchaseStoreProductAsync(productId: string, appAccountToken: string): Promise<StoreTransaction>;
  restoreStorePurchasesAsync(): Promise<StoreTransaction[]>;
  getStoreEntitlementsAsync(): Promise<StoreTransaction[]>;
  finishStoreTransactionAsync(transactionId: string): Promise<boolean>;
  showManageStoreSubscriptionsAsync(): Promise<boolean>;
};

export type StoreProduct = {
  id: string;
  displayName: string;
  description: string;
  displayPrice: string;
  price: number;
  periodUnit?: string;
  periodValue?: number;
  introDisplayPrice?: string;
  introPeriods?: number;
};

export type StoreTransaction = {
  status: "verified" | "pending" | "cancelled";
  productId: string;
  transactionId?: string;
  originalTransactionId?: string;
  signedTransaction?: string;
  purchaseDateMs?: number;
  expiresDateMs?: number;
  revocationDateMs?: number;
};

const NativeSync =
  Platform.OS === "ios"
    ? ((requireOptionalNativeModule("InteliAdsNativeSync") as NativeModule | null) ?? null)
    : null;

export const NATIVE_REFRESH_TASK_ID = "io.inteliads.app.refresh";
export const NATIVE_PROCESSING_TASK_ID = "io.inteliads.app.processing";
export const APP_GROUP_ID = "group.io.inteliads.app";

export function isNativeSyncAvailable(): boolean {
  return NativeSync != null;
}

export function isStoreKitAvailable(): boolean {
  return NativeSync != null && Platform.OS === "ios";
}

export async function getStoreProducts(): Promise<StoreProduct[]> {
  return NativeSync ? NativeSync.getStoreProductsAsync() : [];
}

export async function purchaseStoreProduct(productId: string, appAccountToken: string): Promise<StoreTransaction> {
  if (!NativeSync) throw new Error("App Store purchases are unavailable.");
  return NativeSync.purchaseStoreProductAsync(productId, appAccountToken);
}

export async function restoreStorePurchases(): Promise<StoreTransaction[]> {
  return NativeSync ? NativeSync.restoreStorePurchasesAsync() : [];
}

export async function getStoreEntitlements(): Promise<StoreTransaction[]> {
  return NativeSync ? NativeSync.getStoreEntitlementsAsync() : [];
}

export async function finishStoreTransaction(transactionId: string): Promise<boolean> {
  if (!NativeSync) return false;
  return NativeSync.finishStoreTransactionAsync(transactionId);
}

export async function showManageStoreSubscriptions(): Promise<boolean> {
  if (!NativeSync) return false;
  return NativeSync.showManageStoreSubscriptionsAsync();
}

export async function getNativeApnsEnvironment(): Promise<ApnsEnvironment | null> {
  if (!NativeSync) return null;
  try {
    const environment = await NativeSync.getApnsEnvironmentAsync();
    return environment === "sandbox" || environment === "production" ? environment : null;
  } catch {
    return null;
  }
}

/** Read cookies that WKWebView would send to this URL, including HttpOnly. */
export async function getNativeCookieHeader(url: string): Promise<string | null> {
  if (!NativeSync || !url) return null;
  try {
    const value = await NativeSync.getCookieHeaderAsync(url);
    return typeof value === "string" && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

/** Clear only Amazon/KDP WKWebView cookies before changing import account. */
export async function clearNativeAmazonKdpCookies(): Promise<boolean> {
  if (!NativeSync) return Platform.OS !== "ios";
  try {
    await NativeSync.clearAmazonKdpCookiesAsync();
    return true;
  } catch {
    return false;
  }
}

export async function registerNativeMetronome(force = true): Promise<boolean> {
  if (!NativeSync) return false;
  try {
    return await NativeSync.registerAndScheduleAsync(force);
  } catch {
    return false;
  }
}

export async function scheduleNativeMetronome(force = false): Promise<boolean> {
  if (!NativeSync) return false;
  try {
    return await NativeSync.scheduleIfNeededAsync(force);
  } catch {
    return false;
  }
}

export async function getNativeMetronomeStatus(): Promise<NativeSyncStatus | null> {
  if (!NativeSync) return null;
  try {
    return await NativeSync.getStatusAsync();
  } catch {
    return null;
  }
}

export async function updateNativeSyncSnapshot(payload: SyncSnapshotPayload): Promise<boolean> {
  if (!NativeSync) return false;
  try {
    return await NativeSync.updateSyncSnapshotAsync(payload);
  } catch {
    return false;
  }
}

/** Publish only source-verified finance. `verified: false` clears a mismatched scope. */
export async function updateNativeFinancialSnapshot(
  payload: FinancialWidgetSnapshotPayload,
): Promise<boolean> {
  if (!NativeSync) return false;
  try {
    return await NativeSync.updateFinancialSnapshotAsync(payload);
  } catch {
    return false;
  }
}

export async function getNativeSyncSnapshot(): Promise<Record<string, unknown> | null> {
  if (!NativeSync) return null;
  try {
    return await NativeSync.getSyncSnapshotAsync();
  } catch {
    return null;
  }
}

/** One-shot kind set by native BGAppRefresh/BGProcessing before TaskManager runs. */
export async function consumeNativeWakeKind(): Promise<NativeWakeKind | null> {
  if (!NativeSync) return null;
  try {
    const kind = await NativeSync.consumePendingWakeKindAsync();
    if (kind === "recent" || kind === "processing") return kind;
    return null;
  } catch {
    return null;
  }
}
