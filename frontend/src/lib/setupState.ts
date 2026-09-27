/**
 * Shared setup snapshot. Derived from live facts — never a fake percent.
 * Required steps change with what the account actually has (Ads, KDP, both).
 */

export type SetupStepId =
  | "account"
  | "ads_connected"
  | "profile_activated"
  | "kdp_source"
  | "first_sync"
  | "plan";

export type SetupStepStatus = "done" | "todo" | "blocked" | "optional";

export type SetupStep = {
  id: SetupStepId;
  title: string;
  body: string;
  status: SetupStepStatus;
  href: string;
  cta: string;
  required: boolean;
};

export type SetupSnapshot = {
  next: SetupStep | null;
  steps: SetupStep[];
  completedRequired: number;
  requiredTotal: number;
  label: string;
};

export type KnownFlag = boolean | "unknown";

export type SetupFacts = {
  signedIn: boolean;
  guest: boolean;
  discoveredAdsProfiles: number;
  activatedAdsProfiles: number;
  kdpAccountLinked: KnownFlag;
  kdpImporterActive: KnownFlag;
  adsSyncSucceeded: boolean;
  planKnown: boolean;
  hasPlan: boolean;
};

export type SyncLogStatusRow = {
  status?: string | null;
  completed_at?: string | null;
  campaigns_synced?: number | null;
  keywords_synced?: number | null;
  product_ads_synced?: number | null;
  ad_groups_synced?: number | null;
  product_targets_synced?: number | null;
};

function syncedEntityCount(row: SyncLogStatusRow): number {
  return (
    Number(row.campaigns_synced ?? 0) +
    Number(row.keywords_synced ?? 0) +
    Number(row.product_ads_synced ?? 0) +
    Number(row.ad_groups_synced ?? 0) +
    Number(row.product_targets_synced ?? 0)
  );
}

/**
 * Sync-log proof that Ads data landed.
 * - `completed` counts (case-insensitive).
 * - `partial_failed` counts only when entities were actually written —
 *   empty partials do not.
 * Mere leftover `campaign_metrics` row presence is intentionally not a
 * signal here (see `adsDataHasArrived` for live portfolio money / stamps).
 */
export function adsDataArrivedFromSyncLogs(logs: readonly SyncLogStatusRow[]): boolean {
  return logs.some((row) => {
    const status = String(row.status ?? "").toLowerCase();
    if (status === "completed") return true;
    if (status === "partial_failed" || status === "partial") {
      return syncedEntityCount(row) > 0;
    }
    return false;
  });
}

export type AdsArrivalEvidence = {
  syncLogs?: readonly SyncLogStatusRow[];
  /** ISO stamp from a completed profile sync or home snapshot freshness. */
  lastSuccessfulAdsSync?: string | null;
  /**
   * Live portfolio Ads money for the loaded period.
   * Positive spend/sales proves data arrived — empty leftover rows do not.
   */
  liveAdsSpend?: number | null;
  liveAdsSales?: number | null;
  /** Enabled profiles with a non-zero campaign catalog (Nest count). */
  enabledCatalogCampaigns?: number | null;
};

/**
 * Ground truth for the setup `first_sync` step.
 * Prefer completed sync logs; also complete when Overview already has
 * successful Ads money, a last-success stamp, or an enabled catalog.
 */
export function adsDataHasArrived(evidence: AdsArrivalEvidence): boolean {
  if (adsDataArrivedFromSyncLogs(evidence.syncLogs ?? [])) return true;
  if (String(evidence.lastSuccessfulAdsSync ?? "").trim()) return true;
  const spend = Number(evidence.liveAdsSpend);
  const sales = Number(evidence.liveAdsSales);
  if ((Number.isFinite(spend) && spend > 0) || (Number.isFinite(sales) && sales > 0)) {
    return true;
  }
  const catalog = Number(evidence.enabledCatalogCampaigns);
  return Number.isFinite(catalog) && catalog > 0;
}

function step(
  id: SetupStepId,
  status: SetupStepStatus,
  required: boolean,
  fields: Pick<SetupStep, "title" | "body" | "href" | "cta">,
): SetupStep {
  return { id, status, required, ...fields };
}

export function deriveSetupSnapshot(facts: SetupFacts): SetupSnapshot {
  if (facts.guest || !facts.signedIn) {
    const account = step("account", "todo", true, {
      title: "Sign in",
      body: "Use the same InteliAds account as the web app.",
      href: "/auth/login",
      cta: "Sign in",
    });
    return pack([account]);
  }

  const adsConnected =
    facts.discoveredAdsProfiles > 0
      ? step("ads_connected", "done", true, {
          title: "Amazon Ads connected",
          body: "Advertising profiles are on this account.",
          href: "/more/accounts",
          cta: "Accounts",
        })
      : step("ads_connected", "todo", true, {
          title: "Connect Amazon Ads",
          body: "Link the Ads account you already use on the web, or start that connection here.",
          href: "/more/accounts",
          cta: "Connect account",
        });

  const activated =
    facts.activatedAdsProfiles > 0
      ? step("profile_activated", "done", facts.discoveredAdsProfiles > 0, {
          title: "Profiles on",
          body: `${facts.activatedAdsProfiles} advertising ${facts.activatedAdsProfiles === 1 ? "profile is" : "profiles are"} enabled for sync.`,
          href: "/more/accounts",
          cta: "Profiles",
        })
      : step("profile_activated", facts.discoveredAdsProfiles > 0 ? "todo" : "blocked", facts.discoveredAdsProfiles > 0, {
          title: "Turn on a profile",
          body: "A discovered marketplace is not enabled yet, so it is not in sync or summaries.",
          href: "/more/accounts",
          cta: "Turn on profile",
        });

  const kdpUnknown =
    facts.kdpAccountLinked === "unknown" || facts.kdpImporterActive === "unknown";
  const kdp =
    kdpUnknown
      ? step("kdp_source", "optional", false, {
          title: "KDP import",
          body: "KDP status has not loaded yet.",
          href: "/more/kdp-source",
          cta: "KDP source",
        })
      : facts.kdpImporterActive || facts.kdpAccountLinked
        ? step("kdp_source", "done", false, {
            title: "KDP import",
            body: facts.kdpImporterActive
              ? "Royalties are arriving from Chrome or the iPhone helper."
              : "A KDP account is linked. Import still has to run.",
            href: "/more/kdp-source",
            cta: "KDP source",
          })
        : step("kdp_source", "optional", false, {
            title: "Import KDP royalties",
            body: "Needed for net profit. Chrome on a computer, or the iPhone helper. Skip if you only need Ads.",
            href: "/more/kdp-source",
            cta: "Set up import",
          });

  const sync =
    facts.adsSyncSucceeded
      ? step("first_sync", "done", facts.activatedAdsProfiles > 0, {
          title: "Ads data arrived",
          body: "At least one enabled profile has a successful sync.",
          href: "/more/sync",
          cta: "Sync",
        })
      : step("first_sync", facts.activatedAdsProfiles > 0 ? "todo" : "blocked", facts.activatedAdsProfiles > 0, {
          title: "Wait for the first Ads sync",
          body: "Enabled profiles still have no successful sync. Open Sync to see the last attempt.",
          href: "/more/sync",
          cta: "Open Sync",
        });

  const plan = facts.hasPlan
    ? step("plan", "done", false, {
        title: "Plan on file",
        body: "Billing is the Nest plan shared with the web app.",
        href: "/more/settings",
        cta: "Plan",
      })
    : step("plan", facts.planKnown ? "optional" : "optional", false, {
        title: "Plan",
        body: facts.planKnown
          ? "No plan on this account yet. Ads numbers still load for connected profiles."
          : "Plan status has not loaded.",
        href: "/more/settings",
        cta: "View plan",
      });

  return pack([adsConnected, activated, kdp, sync, plan]);
}

function pack(steps: SetupStep[]): SetupSnapshot {
  const required = steps.filter((item) => item.required);
  const completedRequired = required.filter((item) => item.status === "done").length;
  const next = steps.find((item) => item.required && (item.status === "todo" || item.status === "blocked"))
    ?? steps.find((item) => item.status === "todo")
    ?? null;
  const label =
    required.length === 0
      ? "Setup complete"
      : `${completedRequired} of ${required.length} needed`;
  return { next, steps, completedRequired, requiredTotal: required.length, label };
}

export function setupProgressMemoryField(): "setup_progress" {
  return "setup_progress";
}

export type SetupProgressMemory = {
  updatedAt: string;
  dismissed: Partial<Record<SetupStepId, string>>;
};

export function parseSetupProgressMemory(raw: unknown): SetupProgressMemory | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Partial<SetupProgressMemory>;
  const updatedAt = typeof row.updatedAt === "string" ? row.updatedAt : "";
  if (!updatedAt) return null;
  const dismissed: SetupProgressMemory["dismissed"] = {};
  if (row.dismissed && typeof row.dismissed === "object") {
    for (const [key, value] of Object.entries(row.dismissed)) {
      if (typeof value === "string" && value) dismissed[key as SetupStepId] = value;
    }
  }
  return { updatedAt, dismissed };
}

export function mergeSetupProgress(
  local: SetupProgressMemory | null,
  remote: unknown,
): SetupProgressMemory | null {
  return newerSetupMemory(local, parseSetupProgressMemory(remote));
}

export function newerSetupMemory(
  local: SetupProgressMemory | null,
  remote: SetupProgressMemory | null,
): SetupProgressMemory | null {
  if (!local) return remote;
  if (!remote) return local;
  return Date.parse(remote.updatedAt) >= Date.parse(local.updatedAt) ? remote : local;
}

export function applySetupDismissals(
  snapshot: SetupSnapshot,
  memory: SetupProgressMemory | null,
): SetupSnapshot {
  if (!memory) return snapshot;
  const steps = snapshot.steps.map((item) => {
    if (item.required) return item;
    if (!memory.dismissed[item.id]) return item;
    return { ...item, status: "done" as const, body: "You chose to do this later." };
  });
  return pack(steps);
}
