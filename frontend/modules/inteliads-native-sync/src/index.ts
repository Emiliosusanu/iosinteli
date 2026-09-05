import { requireNativeModule, Platform } from "expo-modules-core";

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

export type NativeWakeKind = "recent" | "processing";

type NativeModule = {
  registerAndScheduleAsync(force: boolean): Promise<boolean>;
  scheduleIfNeededAsync(force: boolean): Promise<boolean>;
  setEnabledAsync(enabled: boolean): Promise<boolean>;
  getStatusAsync(): Promise<NativeSyncStatus>;
  consumePendingWakeKindAsync(): Promise<string | null>;
  updateSyncSnapshotAsync(payload: SyncSnapshotPayload): Promise<boolean>;
  getSyncSnapshotAsync(): Promise<Record<string, unknown>>;
};

const NativeSync =
  Platform.OS === "ios"
    ? (requireNativeModule("InteliAdsNativeSync") as NativeModule)
    : null;

export const NATIVE_REFRESH_TASK_ID = "io.inteliads.app.refresh";
export const NATIVE_PROCESSING_TASK_ID = "io.inteliads.app.processing";
export const APP_GROUP_ID = "group.io.inteliads.app";

export function isNativeSyncAvailable(): boolean {
  return NativeSync != null;
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
