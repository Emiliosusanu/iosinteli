import { storage } from "../utils/storage";
import {
  emptyRoyaltySetupMemory,
  normalizeRoyaltySetupMemory,
  ROYALTY_SETUP_DISMISS_MS,
  royaltySetupMemoryKey,
  type RoyaltySetupMemory,
} from "./kdpRoyaltySetup.ts";

export async function loadRoyaltySetupMemory(userId: string | null | undefined): Promise<RoyaltySetupMemory> {
  const key = royaltySetupMemoryKey(userId);
  if (!key) return emptyRoyaltySetupMemory();
  try {
    const raw = await storage.getItem<string>(key, "");
    if (!raw || typeof raw !== "string") return emptyRoyaltySetupMemory();
    return normalizeRoyaltySetupMemory(JSON.parse(raw));
  } catch {
    return emptyRoyaltySetupMemory();
  }
}

async function writeMemory(userId: string | null | undefined, next: RoyaltySetupMemory): Promise<void> {
  const key = royaltySetupMemoryKey(userId);
  if (!key) return;
  try {
    await storage.setItem(key, JSON.stringify(next));
  } catch {
    /* best-effort */
  }
}

export async function rememberRoyaltySetupAsked(kind: string, userId: string | null | undefined): Promise<RoyaltySetupMemory> {
  const current = await loadRoyaltySetupMemory(userId);
  if (!kind || current.askedKinds.includes(kind)) return current;
  const next = { ...current, askedKinds: [...current.askedKinds, kind] };
  await writeMemory(userId, next);
  return next;
}

export async function dismissRoyaltySetup(nowMs: number, userId: string | null | undefined): Promise<RoyaltySetupMemory> {
  const current = await loadRoyaltySetupMemory(userId);
  const next = { ...current, dismissedUntilMs: nowMs + ROYALTY_SETUP_DISMISS_MS };
  await writeMemory(userId, next);
  return next;
}
