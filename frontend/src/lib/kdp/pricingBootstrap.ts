/**
 * Hands-free pricing bootstrap flags (per KDP account).
 * After one helper login, background ticks keep pricing until the shelf is done.
 */
import { storage } from "@/src/utils/storage";

const BOOT_KEY = "inteliads.kdpHelper.pricingBootstrap.v1";

export type PricingBootstrapState = {
  /** Silent bookshelf fetch succeeded (HTML had print-setup signals). */
  bookshelfSeededAt: string | null;
  /** Soft: print-setup step-up needed once; clear when pricing succeeds. */
  authBlockedAt: string | null;
};

type BootRoot = Record<string, PricingBootstrapState>;

const EMPTY: PricingBootstrapState = {
  bookshelfSeededAt: null,
  authBlockedAt: null,
};

async function loadRoot(): Promise<BootRoot> {
  try {
    const raw = await storage.getItem<string>(BOOT_KEY, "");
    if (!raw || typeof raw !== "string") return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as BootRoot) : {};
  } catch {
    return {};
  }
}

async function saveRoot(root: BootRoot): Promise<void> {
  await storage.setItem(BOOT_KEY, JSON.stringify(root));
}

export async function loadPricingBootstrap(
  accountId: string,
): Promise<PricingBootstrapState> {
  const acct = String(accountId || "").trim();
  if (!acct) return { ...EMPTY };
  const root = await loadRoot();
  const row = root[acct];
  if (!row || typeof row !== "object") return { ...EMPTY };
  return {
    bookshelfSeededAt: row.bookshelfSeededAt ? String(row.bookshelfSeededAt) : null,
    authBlockedAt: row.authBlockedAt ? String(row.authBlockedAt) : null,
  };
}

export async function patchPricingBootstrap(
  accountId: string,
  patch: Partial<PricingBootstrapState>,
): Promise<PricingBootstrapState> {
  const acct = String(accountId || "").trim();
  if (!acct) return { ...EMPTY };
  const root = await loadRoot();
  const next = { ...(root[acct] || EMPTY), ...patch };
  root[acct] = next;
  await saveRoot(root);
  return next;
}

/**
 * Restore the in-memory "Sign in for paperback pricing" banner from durable
 * authBlockedAt after process restart (runtime flag alone is lost).
 */
export async function hydratePricingAuthBannerFromBootstrap(
  accountId: string,
): Promise<boolean> {
  const boot = await loadPricingBootstrap(accountId);
  if (!boot.authBlockedAt) return false;
  try {
    const { setKdpHelperPricingAuth } = await import("./runtime.ts");
    setKdpHelperPricingAuth({ required: true, bookId: null });
  } catch {
    return false;
  }
  return true;
}

/** True when bookshelf HTML looks like a logged-in KDP shelf. */
export function bookshelfHtmlLooksSeeded(html: string): boolean {
  const s = String(html || "");
  if (s.length < 400) return false;
  if (/ap\/signin|authportal|sign[\s_-]?in/i.test(s.slice(0, 2000))) return false;
  return /print-setup|dual-print-price-asin|title-setup\/paperback/i.test(s);
}
