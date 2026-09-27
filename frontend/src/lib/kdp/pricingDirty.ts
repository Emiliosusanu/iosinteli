/**
 * Dirty print-setup IDs — Chrome parity for “you just saved a list price”.
 * Persisted per KDP account; cleared after a successful pricing fetch.
 */
import { storage } from "@/src/utils/storage";
import { looksLikeKdpSetupBookId } from "./vendor/kdpPricingCapture.js";

const DIRTY_KEY = "inteliads.kdpHelper.pricingDirty.v1";
const MAX_DIRTY = 100;

export type DirtyPricingEntry = {
  setupId: string;
  at: string;
  source: string;
};

type DirtyRoot = Record<string, Record<string, { at?: string; source?: string }>>;

function normalizeSetupId(value: unknown): string {
  return String(value || "")
    .trim()
    .toUpperCase();
}

async function loadRoot(): Promise<DirtyRoot> {
  try {
    const raw = await storage.getItem<string>(DIRTY_KEY, "");
    if (!raw || typeof raw !== "string") return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as DirtyRoot) : {};
  } catch {
    return {};
  }
}

async function saveRoot(root: DirtyRoot): Promise<void> {
  await storage.setItem(DIRTY_KEY, JSON.stringify(root));
}

export async function loadDirtyPricingSetupIds(
  accountId: string,
): Promise<DirtyPricingEntry[]> {
  const acct = String(accountId || "").trim();
  if (!acct) return [];
  const root = await loadRoot();
  const entries = root[acct] && typeof root[acct] === "object" ? root[acct] : {};
  return Object.entries(entries)
    .map(([id, value]) => ({
      setupId: normalizeSetupId(id),
      at: String(value?.at || ""),
      source: String(value?.source || "kdp_price_change").slice(0, 40),
    }))
    .filter((entry) => looksLikeKdpSetupBookId(entry.setupId));
}

export async function markPricingSetupDirty(
  accountId: string,
  setupId: string,
  opts: { source?: string } = {},
): Promise<boolean> {
  const acct = String(accountId || "").trim();
  const id = normalizeSetupId(setupId);
  if (!acct || !looksLikeKdpSetupBookId(id)) return false;
  const root = await loadRoot();
  const accountEntries = {
    ...(root[acct] && typeof root[acct] === "object" ? root[acct] : {}),
  };
  accountEntries[id] = {
    at: new Date().toISOString(),
    source: String(opts.source || "kdp_price_change").slice(0, 40),
  };
  const keys = Object.keys(accountEntries);
  if (keys.length > MAX_DIRTY) {
    keys
      .sort((a, b) =>
        String(accountEntries[a]?.at || "").localeCompare(String(accountEntries[b]?.at || "")),
      )
      .slice(0, keys.length - MAX_DIRTY)
      .forEach((key) => {
        delete accountEntries[key];
      });
  }
  root[acct] = accountEntries;
  await saveRoot(root);
  return true;
}

export async function clearDirtyPricingSetupIds(
  accountId: string,
  setupIds: readonly string[],
): Promise<number> {
  const acct = String(accountId || "").trim();
  if (!acct || !setupIds.length) return 0;
  const root = await loadRoot();
  const accountEntries = {
    ...(root[acct] && typeof root[acct] === "object" ? root[acct] : {}),
  };
  let cleared = 0;
  for (const raw of setupIds) {
    const id = normalizeSetupId(raw);
    if (accountEntries[id]) {
      delete accountEntries[id];
      cleared += 1;
    }
  }
  root[acct] = accountEntries;
  await saveRoot(root);
  return cleared;
}
