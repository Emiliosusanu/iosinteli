import { storage } from "@/src/utils/storage";
import {
  createInitialSyncState,
  normalizeSyncState,
  type KdpSyncState,
} from "./planner.ts";
import type { KdpCapturedTemplate, KdpTemplateType } from "./templates.ts";

const TEMPLATES_KEY = "inteliads.kdpHelper.templates";
const STATE_KEY = "inteliads.kdpHelper.syncState";
const ACCOUNT_KEY = "inteliads.kdpHelper.accountId";

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

export async function saveHelperTemplates(
  templates: Partial<Record<KdpTemplateType, KdpCapturedTemplate>>,
): Promise<void> {
  try {
    await storage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
  } catch {
    /* best-effort */
  }
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

export async function saveHelperSyncState(state: KdpSyncState): Promise<void> {
  try {
    await storage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    /* best-effort */
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

export async function saveHelperAccountId(id: string): Promise<void> {
  try {
    await storage.setItem(ACCOUNT_KEY, id);
  } catch {
    /* best-effort */
  }
}

export async function clearHelperProgress(): Promise<void> {
  try {
    await storage.removeItem(STATE_KEY);
    await storage.removeItem(TEMPLATES_KEY);
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
