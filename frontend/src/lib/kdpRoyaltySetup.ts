/**
 * When KDP royalties are not arriving for an account, decide what to ask.
 *
 * Import health is account-level (last Chrome/helper sync), not the selected
 * Overview period. A quiet week with a fresh importer is not a setup problem.
 *
 * Chrome cannot be installed on iPhone — "activate Chrome" opens the web
 * dashboard. The iPhone helper is the on-device path.
 */
import { isIosHelperEnabled, type KdpRoyaltySource } from "./kdp/source.ts";

export const EXTENSION_FRESH_MS = 36 * 60 * 60 * 1000;
export const ROYALTY_SETUP_DISMISS_MS = 7 * 24 * 60 * 60 * 1000;

export type ExtensionLifecycle = "never" | "stale" | "active";
export type HelperLifecycle = "off" | "needs_signin" | "needs_import" | "running";

export type RoyaltySetupActionId = "helper" | "chrome" | "accounts" | "later";

export type RoyaltySetupKind =
  | "none"
  | "onboard_new"
  | "never_activated"
  | "extension_stale"
  | "helper_needs_signin"
  | "helper_needs_import"
  | "unlinked";

export type RoyaltySetupAsk = {
  kind: Exclude<RoyaltySetupKind, "none">;
  title: string;
  body: string;
  primary: { id: RoyaltySetupActionId; label: string };
  secondary: { id: RoyaltySetupActionId; label: string };
};

export type RoyaltySetupPlan = { kind: "none" } | RoyaltySetupAsk;

export type RoyaltyCollectionDest = "ask" | "helper" | "source";

/** Where Overview/Books "Helper" / empty taps should go — never a dead helper when Chrome-only. */
export function royaltyCollectionShortcut(input: {
  helperOn: boolean;
  askKind: RoyaltySetupKind;
}): { label: string; dest: RoyaltyCollectionDest } {
  if (input.askKind === "unlinked") return { label: "Link", dest: "ask" };
  if (input.askKind === "helper_needs_signin" || input.askKind === "helper_needs_import") {
    return { label: "Helper", dest: "ask" };
  }
  if (input.askKind !== "none") return { label: "Import", dest: "ask" };
  if (input.helperOn) return { label: "Helper", dest: "helper" };
  return { label: "Import", dest: "source" };
}

export type RoyaltySetupMemory = {
  dismissedUntilMs: number;
  askedKinds: string[];
};

export function emptyRoyaltySetupMemory(): RoyaltySetupMemory {
  return { dismissedUntilMs: 0, askedKinds: [] };
}

export function royaltySetupMemoryKey(userId: string | null | undefined): string | null {
  return userId ? `inteliads.kdpRoyaltySetup.v2:${encodeURIComponent(userId)}` : null;
}

export function normalizeRoyaltySetupMemory(raw: unknown): RoyaltySetupMemory {
  const empty = emptyRoyaltySetupMemory();
  if (!raw || typeof raw !== "object") return empty;
  const row = raw as Partial<RoyaltySetupMemory>;
  const dismissedUntilMs = Number(row.dismissedUntilMs);
  const askedKinds = Array.isArray(row.askedKinds)
    ? row.askedKinds.filter((kind): kind is string => typeof kind === "string" && kind.length > 0)
    : [];
  return {
    dismissedUntilMs: Number.isFinite(dismissedUntilMs) && dismissedUntilMs > 0 ? dismissedUntilMs : 0,
    askedKinds: [...new Set(askedKinds)],
  };
}

export type RoyaltySetupAccount = {
  id?: string;
  last_synced_at?: string | null;
  /** Accepted financial delivery; last_synced_at can be catalog-only. */
  royalties_last_synced_at?: string | null;
  linked_amazon_profile_ids?: string[] | null;
};

export type RoyaltySetupInput = {
  guest: boolean;
  viewingCustomer: boolean;
  loading: boolean;
  accountsError: boolean;
  royaltyScopeReason?: string | null;
  source: KdpRoyaltySource;
  helperLoggedIn: boolean;
  helperSavedSession?: boolean;
  helperRunning: boolean;
  /** Legacy attempt stamps. They are not evidence of an accepted import. */
  lastHelperRunAtMs?: number;
  lastHelperRunYmd?: string | null;
  accounts: readonly RoyaltySetupAccount[];
  viewProfileIds: readonly string[];
  latestImportedYmd: string | null;
  yesterdayYmd: string;
  nowMs: number;
  dismissedUntilMs: number;
};

export function parseSyncMs(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const ms = Date.parse(String(raw));
  return Number.isFinite(ms) ? ms : null;
}

export function latestAccountSyncMs(accounts: readonly RoyaltySetupAccount[]): number | null {
  let latest: number | null = null;
  for (const account of accounts) {
    const ms = parseSyncMs(account.royalties_last_synced_at);
    if (ms == null) continue;
    if (latest == null || ms > latest) latest = ms;
  }
  return latest;
}

export function kdpAccountLinkedToProfiles(
  accounts: readonly RoyaltySetupAccount[],
  profileIds: readonly string[],
): boolean {
  const wanted = new Set(profileIds.map((id) => String(id || "").trim()).filter(Boolean));
  if (!wanted.size) return false;
  return accounts.some((account) =>
    (account.linked_amazon_profile_ids ?? []).some((id) => wanted.has(String(id || "").trim())),
  );
}

export function classifyExtensionLifecycle(input: {
  accounts: readonly RoyaltySetupAccount[];
  latestImportedYmd: string | null;
  yesterdayYmd: string;
  nowMs: number;
}): ExtensionLifecycle {
  const importedYmd = String(input.latestImportedYmd || "").slice(0, 10);
  if (importedYmd && importedYmd >= input.yesterdayYmd) return "active";
  const lastMs = latestAccountSyncMs(input.accounts);
  if (lastMs != null && input.nowMs - lastMs <= EXTENSION_FRESH_MS) return "active";
  if (lastMs != null || importedYmd) return "stale";
  return "never";
}

export function classifyHelperLifecycle(input: {
  source: KdpRoyaltySource;
  helperLoggedIn: boolean;
  helperSavedSession?: boolean;
  helperRunning: boolean;
  lastHelperRunAtMs?: number;
  lastHelperRunYmd?: string | null;
  yesterdayYmd?: string;
  nowMs?: number;
}): HelperLifecycle {
  if (!isIosHelperEnabled(input.source)) return "off";
  if (input.helperRunning) return "running";
  // A saved session can be checked/restored by the helper, but does not prove
  // Amazon is signed in or that a day was accepted by the server.
  if (input.helperLoggedIn || input.helperSavedSession) return "needs_import";
  return "needs_signin";
}

/** First-import setup proof, separate from a running job or a saved login. */
export function kdpImporterEvidence(input: {
  accounts?: readonly RoyaltySetupAccount[];
  accountsUnavailable: boolean;
  latestImportedYmd: string | null;
  yesterdayYmd: string;
  nowMs: number;
}): boolean | "unknown" {
  if (input.accountsUnavailable) return "unknown";
  if (!input.latestImportedYmd && input.accounts?.some((account) => account.royalties_last_synced_at === undefined)) {
    return "unknown";
  }
  return classifyExtensionLifecycle({ ...input, accounts: input.accounts ?? [] }) === "active";
}

const HELPER_PRIMARY = { id: "helper" as const, label: "iPhone helper" };
const CHROME_SECONDARY = { id: "chrome" as const, label: "Chrome on a computer" };
const LATER = { id: "later" as const, label: "Later" };

export function planKdpRoyaltySetup(input: RoyaltySetupInput): RoyaltySetupPlan {
  if (input.guest || input.viewingCustomer) return { kind: "none" };
  if (input.loading || input.accountsError) return { kind: "none" };
  if (input.dismissedUntilMs > 0 && input.nowMs < input.dismissedUntilMs) return { kind: "none" };

  const extension = classifyExtensionLifecycle(input);
  const helper = classifyHelperLifecycle(input);

  if (extension === "active") {
    if (input.accounts.length > 0 && !kdpAccountLinkedToProfiles(input.accounts, input.viewProfileIds)) {
      return {
        kind: "unlinked",
        title: "KDP isn't linked to this view",
        body: "Royalties are importing, but this Amazon profile isn't linked to a KDP account.",
        primary: { id: "accounts", label: "Link in Accounts" },
        secondary: LATER,
      };
    }
    return { kind: "none" };
  }

  if (helper === "running") return { kind: "none" };
  if (helper === "needs_import") {
    return {
      kind: "helper_needs_import",
      title: "Finish KDP import on this iPhone",
      body: "No recent import has been saved. Open the helper to check the Amazon session and finish importing royalties.",
      primary: { id: "helper", label: "Open helper" },
      secondary: LATER,
    };
  }

  if (helper === "needs_signin") {
    return {
      kind: "helper_needs_signin",
      title: "Sign in to KDP on this iPhone",
      body: "The iPhone helper is on, but KDP sign-in is still needed before royalties can import.",
      primary: { id: "helper", label: "Open helper" },
      secondary: LATER,
    };
  }

  if (extension === "stale") {
    return {
      kind: "extension_stale",
      title: "Royalties haven't updated lately",
      body: "Nothing new has arrived from KDP. Open Chrome on a computer, or turn on the iPhone helper.",
      primary: HELPER_PRIMARY,
      secondary: CHROME_SECONDARY,
    };
  }

  if (input.accounts.length === 0) {
    return {
      kind: "onboard_new",
      title: "Import KDP royalties",
      body: "This iPhone cannot read KDP by itself. Use the Chrome extension on a computer, or turn on the iPhone helper.",
      primary: HELPER_PRIMARY,
      secondary: CHROME_SECONDARY,
    };
  }

  return {
    kind: "never_activated",
    title: "Royalties aren't arriving",
    body: "No Chrome or iPhone helper has imported KDP for this account yet. Activate one to see royalties.",
    primary: HELPER_PRIMARY,
    secondary: CHROME_SECONDARY,
  };
}
