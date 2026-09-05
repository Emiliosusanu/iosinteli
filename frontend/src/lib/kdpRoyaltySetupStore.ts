import { storage } from "../utils/storage";
import {
  emptyRoyaltySetupMemory,
  normalizeRoyaltySetupMemory,
  ROYALTY_SETUP_DISMISS_MS,
  type RoyaltySetupMemory,
} from "./kdpRoyaltySetup.ts";

const MEMORY_KEY = "inteliads.kdpRoyaltySetup.v1";

export async function loadRoyaltySetupMemory(): Promise<RoyaltySetupMemory> {
  try {
    const raw = await storage.getItem<string>(MEMORY_KEY, "");
    if (!raw || typeof raw !== "string") return emptyRoyaltySetupMemory();
    return normalizeRoyaltySetupMemory(JSON.parse(raw));
  } catch {
    return emptyRoyaltySetupMemory();
  }
}

async function writeMemory(next: RoyaltySetupMemory): Promise<void> {
  try {
    await storage.setItem(MEMORY_KEY, JSON.stringify(next));
  } catch {
    /* best-effort */
  }
}

export async function rememberRoyaltySetupAsked(kind: string): Promise<RoyaltySetupMemory> {
  const current = await loadRoyaltySetupMemory();
  if (!kind || current.askedKinds.includes(kind)) return current;
  const next = { ...current, askedKinds: [...current.askedKinds, kind] };
  await writeMemory(next);
  return next;
}

export async function dismissRoyaltySetup(nowMs: number): Promise<RoyaltySetupMemory> {
  const current = await loadRoyaltySetupMemory();
  const next = { ...current, dismissedUntilMs: nowMs + ROYALTY_SETUP_DISMISS_MS };
  await writeMemory(next);
  return next;
}
