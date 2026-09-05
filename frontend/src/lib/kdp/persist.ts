import { storage } from "@/src/utils/storage";
import { normalizeDeferredDays } from "./deferred.ts";
import {
  createInitialSyncState,
  normalizeSyncState,
  type KdpSyncState,
} from "./planner.ts";
import type { KdpCapturedTemplate, KdpTemplateType } from "./templates.ts";

const TEMPLATES_KEY = "inteliads.kdpHelper.templates";
const STATE_KEY = "inteliads.kdpHelper.syncState";
const ACCOUNT_KEY = "inteliads.kdpHelper.accountId";
const DEFERRED_KEY = "inteliads.kdpHelper.deferredDays";
const REPLAY_CURRENCY_KEY = "inteliads.kdpHelper.replayCurrency";

export async function loadHelperTemplates(): Promise<
  Partial<Record<KdpTemplateType, KdpCapturedTemplate>>
> {
  try {
    const raw = await storage.getItem<string>(TEMPLATES_KEY, "");
    if (!raw || typeof raw !== "string") return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  const payload = JSON.stringify(value);
  const ok = await storage.setItem(key, payload);
  if (!ok) throw new Error("Couldn't save KDP helper progress on this iPhone.");
  const verify = await storage.getItem<string>(key, "");
  if (verify !== payload) {
    const retry = await storage.setItem(key, payload);
    if (!retry) throw new Error("Couldn't save KDP helper progress on this iPhone.");
  }
}

export async function saveHelperTemplates(
  templates: Partial<Record<KdpTemplateType, KdpCapturedTemplate>>,
): Promise<void> {
  await writeJson(TEMPLATES_KEY, templates);
}

export async function saveHelperSyncState(state: KdpSyncState): Promise<void> {
  await writeJson(STATE_KEY, state);
}

export async function saveHelperDeferredDays(days: string[]): Promise<void> {
  await writeJson(DEFERRED_KEY, normalizeDeferredDays(days));
}

export async function saveHelperAccountId(id: string): Promise<void> {
  const ok = await storage.setItem(ACCOUNT_KEY, id);
  if (!ok) throw new Error("Couldn't save KDP helper progress on this iPhone.");
}

export async function loadHelperSyncState(): Promise<KdpSyncState> {
  try {
    const raw = await storage.getItem<string>(STATE_KEY, "");
    if (!raw || typeof raw !== "string") return createInitialSyncState();
    return normalizeSyncState(JSON.parse(raw));
  } catch {
    return createInitialSyncState();
  }
}

export async function loadHelperDeferredDays(): Promise<string[]> {
  try {
    const raw = await storage.getItem<string>(DEFERRED_KEY, "");
    if (!raw || typeof raw !== "string") return [];
    return normalizeDeferredDays(JSON.parse(raw));
  } catch {
    return [];
  }
}

export async function loadHelperAccountId(): Promise<string | null> {
  try {
    const raw = await storage.getItem<string>(ACCOUNT_KEY, "");
    return raw && typeof raw === "string" && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

export async function saveHelperReplayCurrency(currency: "EUR" | "USD" | null): Promise<void> {
  if (!currency) {
    try {
      await storage.removeItem(REPLAY_CURRENCY_KEY);
    } catch {
      /* best-effort */
    }
    return;
  }
  const ok = await storage.setItem(REPLAY_CURRENCY_KEY, currency);
  if (!ok) throw new Error("Couldn't save KDP helper progress on this iPhone.");
}

export async function loadHelperReplayCurrency(): Promise<"EUR" | "USD" | null> {
  try {
    const raw = await storage.getItem<string>(REPLAY_CURRENCY_KEY, "");
    const c = String(raw || "").trim().toUpperCase();
    return c === "EUR" || c === "USD" ? c : null;
  } catch {
    return null;
  }
}

export async function clearHelperProgress(): Promise<void> {
  try {
    await storage.removeItem(STATE_KEY);
    await storage.removeItem(TEMPLATES_KEY);
    await storage.removeItem(DEFERRED_KEY);
    await storage.removeItem(REPLAY_CURRENCY_KEY);
    await storage.removeItem(ACCOUNT_KEY);
  } catch {
    /* best-effort */
  }
  try {
    const { clearKdpActivityLog } = await import("./activity.ts");
    await clearKdpActivityLog();
  } catch {
    /* best-effort */
  }
  try {
    const { clearKdpWebSession } = await import("./session.ts");
    await clearKdpWebSession();
  } catch {
    /* best-effort */
  }
}
