/**
 * Persist last Filters / Sort choices per screen (AsyncStorage).
 */
import { storage } from "@/src/utils/storage";
import {
  EMPTY_TARGETING_ADVANCED_FILTERS,
  normalizeTargetingAdvancedFilters,
  type TargetingAdvancedFilters,
} from "@/src/lib/targetingFilters";

const TARGETING_KEY_V2 = "inteliads.filters.targeting.v2";
const TARGETING_KEY_V1 = "inteliads.filters.targeting.v1";
const CAMPAIGNS_KEY = "inteliads.filters.campaigns.v1";
const BOOKS_KEY = "inteliads.filters.books.v1";

export type TargetingFilterMemory = {
  segment?: string;
  perf?: string;
  sort?: string;
  bookAsin?: string;
  bookAsins?: string[];
  stateFilter?: string;
  advanced?: TargetingAdvancedFilters;
};

export function normalizeBookAsinList(raw: unknown, legacySingle?: unknown): string[] {
  const out: string[] = [];
  const push = (value: unknown) => {
    const asin = String(value || "").trim().toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(asin) || out.includes(asin)) return;
    out.push(asin);
  };
  if (Array.isArray(raw)) raw.forEach(push);
  else if (typeof raw === "string" && raw.trim()) push(raw);
  if (!out.length && legacySingle != null) push(legacySingle);
  return out;
}

export type CampaignsFilterMemory = {
  sortKey?: string;
  stateFilter?: string;
  bookAsins?: string[];
};

export type BooksFilterMemory = {
  sort?: string;
};

async function readJson<T extends object>(key: string): Promise<Partial<T>> {
  try {
    const raw = await storage.getItem<string>(key, "");
    if (!raw || typeof raw !== "string") return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Partial<T>) : {};
  } catch {
    return {};
  }
}

async function writeJson(key: string, value: object): Promise<void> {
  try {
    await storage.setItem(key, JSON.stringify(value));
  } catch {
    /* best-effort */
  }
}

function coerceAdvanced(raw: unknown): TargetingAdvancedFilters {
  if (!raw || typeof raw !== "object") return { ...EMPTY_TARGETING_ADVANCED_FILTERS };
  const o = raw as Record<string, unknown>;
  const num = (v: unknown): number | null => {
    if (v == null || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return normalizeTargetingAdvancedFilters({
    acosMin: num(o.acosMin),
    acosMax: num(o.acosMax),
    bidMin: num(o.bidMin),
    bidMax: num(o.bidMax),
    clicksMin: num(o.clicksMin),
    clicksMax: num(o.clicksMax),
    impressionsMin: num(o.impressionsMin),
    impressionsMax: num(o.impressionsMax),
  });
}

export async function loadTargetingFilterMemory(): Promise<TargetingFilterMemory> {
  const v2 = await readJson<TargetingFilterMemory>(TARGETING_KEY_V2);
  if (Object.keys(v2).length) {
    return {
      ...v2,
      advanced: coerceAdvanced(v2.advanced),
    };
  }
  const v1 = await readJson<TargetingFilterMemory>(TARGETING_KEY_V1);
  if (!Object.keys(v1).length) return {};
  return {
    ...v1,
    advanced: { ...EMPTY_TARGETING_ADVANCED_FILTERS },
  };
}

export async function saveTargetingFilterMemory(next: TargetingFilterMemory): Promise<void> {
  const payload: TargetingFilterMemory = {
    ...next,
    advanced: next.advanced
      ? normalizeTargetingAdvancedFilters(next.advanced)
      : { ...EMPTY_TARGETING_ADVANCED_FILTERS },
  };
  await writeJson(TARGETING_KEY_V2, payload);
}

export async function loadCampaignsFilterMemory(): Promise<CampaignsFilterMemory> {
  const mem = await readJson<CampaignsFilterMemory>(CAMPAIGNS_KEY);
  return { ...mem, bookAsins: normalizeBookAsinList(mem.bookAsins) };
}

export async function saveCampaignsFilterMemory(next: CampaignsFilterMemory): Promise<void> {
  await writeJson(CAMPAIGNS_KEY, { ...next, bookAsins: normalizeBookAsinList(next.bookAsins) });
}

export async function loadBooksFilterMemory(): Promise<BooksFilterMemory> {
  return readJson<BooksFilterMemory>(BOOKS_KEY);
}

export async function saveBooksFilterMemory(next: BooksFilterMemory): Promise<void> {
  await writeJson(BOOKS_KEY, next);
}
