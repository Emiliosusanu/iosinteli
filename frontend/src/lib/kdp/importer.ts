/**
 * iPhone KDP helper orchestrator (Royaltix-aligned).
 *
 * Capture once → Keychain session → native replay.
 * Recent wakes (BG / push / interval): today + yesterday, then a leftover slice
 * of nightly/gap/deferred days (14). Processing wakes finish 30→90 onboarding
 * and drain up to 30 leftover days. Nightly last-30 is not sealed until every
 * day in the window is imported; missed days are recovered from the journal and
 * from cloud coverage holes.
 */
import { supabase } from "../supabase.ts";
import { accountLinkedToProfiles, resolveHelperAccountId } from "./accounts.ts";
import { orderDaysForWake } from "./coverage.ts";
import { addDaysYmd, eachYmd, ymdInTz } from "./dates.ts";
import {
  acknowledgeDeferredDays,
  deferredDayLimitForWake,
  journalDeferredDays,
} from "./deferred.ts";
import { cloudHistorySealsOnboarding, cloudMissingDays } from "./history.ts";
import {
  loadHelperAccountId,
  loadHelperDeferredDays,
  loadHelperReplayCurrency,
  loadHelperSyncState,
  loadHelperTemplates,
  saveHelperAccountId,
  saveHelperDeferredDays,
  saveHelperReplayCurrency,
  saveHelperSyncState,
  saveHelperTemplates,
} from "./persist.ts";
import { appendKdpActivity } from "./activity.ts";
import { resolvePreferredReplayCurrency } from "./currency.ts";
import { parseKdpJsonOrThrow, rebuildTemplateForDay } from "./replay.ts";
import { fetchAmazonProfiles } from "../queries.ts";
import {
  hasIncompleteNightly,
  nightlyWindow,
  planSync,
  resolveWakeMode,
  sealNightlyIfClear,
  type KdpSyncState,
  type KdpWakeMode,
} from "./planner.ts";
import {
  getKdpHelperStatus,
  hydrateKdpTemplates,
  kdpPageFetch,
  kdpTemplatesReady,
  navigateKdpWebView,
  setKdpHelperError,
  setKdpHelperRunning,
} from "./runtime.ts";
import { getKdpRoyaltySource } from "./sourceStore.ts";
import { isIosHelperEnabled, type KdpRoyaltySource } from "./source.ts";
import { loadKdpWebSession } from "./session.ts";
import { KDP_CAPTURE_PAGES } from "./templates.ts";
import { writeKdpCatalog, writeKdpDay } from "./upsert.ts";
import { buildKdpFromJsons, buildTitlesRows, extractBooksObj } from "./vendor/kdpVendor.generated.js";

const CAPTURE_WAIT_MS = 28_000;
const LOGIN_WAIT_MS = 8_000;
const WEBVIEW_ATTACH_WAIT_MS = 12_000;
const RATE_LIMIT_BACKOFF_MS = 2_500;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function publishKdpSyncSnapshot(args: {
  status: string;
  detail: string;
  isActive: boolean;
  progress?: number;
  completedAtMs?: number;
}) {
  try {
    const { updateNativeSyncSnapshot } = await import("inteliads-native-sync");
    await updateNativeSyncSnapshot({
      status: args.status,
      detail: args.detail,
      isActive: args.isActive,
      progress: args.progress,
      completedAtMs: args.completedAtMs,
      accountName: "InteliAds",
      reload: true,
    });
  } catch {
    /* native module optional on sim / pre-link */
  }
}

async function waitUntil(pred: () => boolean, ms: number, step = 400): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (pred()) return true;
    await sleep(step);
  }
  return pred();
}

async function currentUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session?.user?.id) return data.session.user.id;
  } catch {
    /* fall through */
  }
  // Email/password Nest login keeps the JWT in Keychain while the Supabase
  // AsyncStorage session can be empty — helper must still resolve the same user.
  try {
    const { resolveHelperUserId } = await import("../rulesApi");
    const fromNest = await resolveHelperUserId();
    if (fromNest) return fromNest;
  } catch {
    /* fall through */
  }
  try {
    const { loadLastMobileHomeScope } = await import("../mobileHomeSnapshot");
    const scope = await loadLastMobileHomeScope();
    if (scope?.userId) return scope.userId;
  } catch {
    /* fall through */
  }
  return null;
}

function isRateLimited(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  return /\b429\b|too many requests|rate.?limit/i.test(message);
}

async function ensureTemplates(): Promise<void> {
  const persisted = await loadHelperTemplates();
  hydrateKdpTemplates(persisted);
  if (kdpTemplatesReady()) return;

  // Background wake: templates + Keychain session are enough (no WebView).
  const session = await loadKdpWebSession();
  if (session?.cookies?.trim() && Object.keys(persisted).length > 0) {
    hydrateKdpTemplates(persisted);
    if (kdpTemplatesReady()) return;
  }

  await waitUntil(() => getKdpHelperStatus().ready, WEBVIEW_ATTACH_WAIT_MS);
  const st = getKdpHelperStatus();
  if (!st.ready) throw new Error("KDP helper is still starting");
  if (!st.loggedIn) {
    throw new Error("Sign in to KDP on this iPhone first");
  }

  for (const page of KDP_CAPTURE_PAGES) {
    if (getKdpHelperStatus().templates[page.type]) continue;
    setKdpHelperRunning(true, `Capturing ${page.type}…`);
    navigateKdpWebView(page.url);
    await waitUntil(() => !!getKdpHelperStatus().templates[page.type], CAPTURE_WAIT_MS);
  }
  await saveHelperTemplates(getKdpHelperStatus().templates);
  if (!kdpTemplatesReady()) {
    throw new Error("Could not capture KDP reports. Open royalties, orders, and KENP once while signed in.");
  }
}

async function fetchJsonForType(
  type: "royalties" | "orders" | "kenp" | "titles" | "titles_latest" | "royalties_titles",
  ymd: string,
  preferredCurrency: "EUR" | "USD" | null = null,
) {
  const template = getKdpHelperStatus().templates[type];
  if (!template) return null;
  const req = rebuildTemplateForDay(template, type, ymd, { preferredCurrency });
  const attempt = async () => {
    const result = await kdpPageFetch(req);
    if (Number(result.status) === 405) {
      const alt = req.method.toUpperCase() === "GET" ? "POST" : "GET";
      const retry = await kdpPageFetch({
        ...req,
        method: alt,
        body: alt === "GET" ? null : req.body,
      });
      return parseKdpJsonOrThrow(retry, type);
    }
    if (Number(result.status) === 429) {
      throw new Error(`${type} fetch failed (429)`);
    }
    return parseKdpJsonOrThrow(result, type);
  };
  try {
    return await attempt();
  } catch (error) {
    if (!isRateLimited(error)) throw error;
    await sleep(RATE_LIMIT_BACKOFF_MS);
    try {
      return await attempt();
    } catch (retryError) {
      if (isRateLimited(retryError) && type !== "royalties") return null;
      throw retryError;
    }
  }
}

async function syncOneDay(
  accountId: string,
  ymd: string,
  titlesJson: unknown,
  preferredCurrency: "EUR" | "USD" | null,
): Promise<void> {
  const royaltiesJson = await fetchJsonForType("royalties", ymd, preferredCurrency);
  const ordersJson = await fetchJsonForType("orders", ymd, preferredCurrency).catch((error) => {
    if (isRateLimited(error)) return null;
    throw error;
  });
  const kenpJson = await fetchJsonForType("kenp", ymd, preferredCurrency).catch((error) => {
    if (isRateLimited(error)) return null;
    throw error;
  });
  if (!royaltiesJson && !ordersJson && !kenpJson) {
    throw new Error(`No KDP payloads for ${ymd}`);
  }
  const built = buildKdpFromJsons({
    ymd,
    titlesJson,
    royaltiesJson,
    ordersJson,
    kenpJson,
    adsJson: null,
    adsEntityId: null,
  });
  await writeKdpDay({
    accountId,
    rowDaily: built.rowDaily,
    rowEntry: built.rowEntry,
    rowsBookDaily: built.rowsBookDaily,
  });
}

async function resolveAccountId(userId: string, profileIds: string[]): Promise<string> {
  const cached = await loadHelperAccountId();
  if (cached) {
    if (!profileIds.length || (await accountLinkedToProfiles(cached, profileIds))) {
      return cached;
    }
  }
  const resolved = await resolveHelperAccountId({ userId, profileIds });
  await saveHelperAccountId(resolved.accountId);
  if (resolved.name) {
    setKdpHelperRunning(true, `Using KDP account “${resolved.name}”`);
  }
  return resolved.accountId;
}

export async function runKdpIosHelperTick(
  reason: string,
  opts: { force?: boolean; profileIds?: string[]; wakeMode?: KdpWakeMode } = {},
): Promise<{ ok: boolean; skipped?: boolean; reason: string; days?: number; wakeMode?: KdpWakeMode }> {
  if (!isIosHelperEnabled(await getKdpRoyaltySource())) {
    void appendKdpActivity("15 min sync skipped · iPhone helper off (Chrome-only source)", "info");
    return { ok: true, skipped: true, reason: "source_off" };
  }

  const userId = await currentUserId();
  if (!userId) {
    void appendKdpActivity("15 min sync skipped · sign in required", "error");
    return { ok: false, skipped: true, reason: "signed_out" };
  }

  // KDP upserts use Supabase RLS. Nest Keychain JWT alone is not enough —
  // without a live Supabase session, writes fail and lastSteady never advances.
  try {
    const live = await supabase.auth.getSession();
    if (!live.data.session) {
      await supabase.auth.refreshSession().catch(() => null);
    }
    const again = await supabase.auth.getSession();
    if (!again.data.session) {
      void appendKdpActivity(
        "15 min sync blocked · Amazon session missing for KDP writes. Open the app and sign in again.",
        "error",
      );
      return { ok: false, skipped: true, reason: "supabase_session_missing" };
    }
  } catch {
    void appendKdpActivity(
      "15 min sync blocked · Amazon session missing for KDP writes. Open the app and sign in again.",
      "error",
    );
    return { ok: false, skipped: true, reason: "supabase_session_missing" };
  }

  let wakeMode = opts.wakeMode ?? resolveWakeMode(reason, { force: opts.force });

  try {
    setKdpHelperRunning(true, reason === "enable" ? "Starting iPhone helper…" : "Syncing KDP…");
    setKdpHelperError(null);
    void publishKdpSyncSnapshot({
      status: "Syncing",
      detail: `KDP helper · ${reason}`,
      isActive: true,
      progress: 0.12,
    });
    void appendKdpActivity(
      reason === "enable" ? "Starting iPhone helper…" : `KDP helper tick (${reason})`,
      "info",
    );

    const session = await loadKdpWebSession();
    const canBackgroundReplay = Boolean(session?.cookies?.trim());
    if (!canBackgroundReplay) {
      await waitUntil(() => getKdpHelperStatus().ready, LOGIN_WAIT_MS);
    }
    await ensureTemplates();

    const accountId = await resolveAccountId(userId, opts.profileIds ?? []);

    // Royaltix: rewrite preferredCurrency on replay. Ads profile currency wins
    // over templates / saved; onboarding default is always USD when unknown.
    const profileCurrencyScope = (await fetchAmazonProfiles(userId).catch(() => [])).filter((p) =>
      (opts.profileIds ?? []).length
        ? (opts.profileIds ?? []).includes(p.id) || (opts.profileIds ?? []).includes(p.profile_id)
        : p.is_enabled !== false,
    );
    const preferredCurrency = resolvePreferredReplayCurrency({
      profiles: profileCurrencyScope,
      templates: getKdpHelperStatus().templates as any,
      saved: await loadHelperReplayCurrency(),
    });
    await saveHelperReplayCurrency(preferredCurrency);
    setKdpHelperRunning(true, `KDP replay currency ${preferredCurrency}`);
    void appendKdpActivity(`Replay currency ${preferredCurrency}`, "currency");

    const titlesYmd = new Date().toISOString().slice(0, 10);
    const titlesJson =
      (await fetchJsonForType("titles", titlesYmd, preferredCurrency).catch(() => null)) ||
      (await fetchJsonForType("titles_latest", titlesYmd, preferredCurrency).catch(() => null)) ||
      (await fetchJsonForType("royalties_titles", titlesYmd, preferredCurrency).catch(() => null));
    if (titlesJson) {
      const shelf = buildTitlesRows({ accountId, booksObj: extractBooksObj(titlesJson) });
      await writeKdpCatalog({
        accountId,
        bookRows: shelf.bookRows,
        formatRows: shelf.formatRows,
        titleRows: shelf.titleRows,
      });
    }

    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    let state: KdpSyncState = await loadHelperSyncState();
    let deferred = await loadHelperDeferredDays();
    const today = ymdInTz(new Date(), tz);
    const yesterday = addDaysYmd(today, -1);

    // Web/Chrome already imported history → seal both milestones.
    if (!state.onboardingDone) {
      const history = await cloudHistorySealsOnboarding(accountId, today);
      if (history.sealed) {
        state = {
          ...state,
          onboardingDone: true,
          milestone30Done: true,
          onboardingCursor: null,
          onboardingFloor: null,
        };
        await saveHelperSyncState(state);
        const histMsg = `Web history found (${history.dayCount} days) — skipping 30→90 backfill`;
        setKdpHelperRunning(true, histMsg);
        void appendKdpActivity(histMsg, "onboarding");
      }
    }

    let totalDays = 0;
    let guard = 0;
    let continueSoon = true;
    let lastSoftError: string | null = null;
    let remaining = deferredDayLimitForWake(wakeMode);
    const steadyAtBeforeTick = state.lastSteadyAtMs;
    let steadyPlanned = false;
    let steadyOk = false;

    while (continueSoon && guard < 16 && remaining > 0) {
      guard += 1;
      const plan = planSync(new Date(), state, {
        timeZone: tz,
        force: opts.force && guard === 1,
        wakeMode,
      });
      state = plan.nextState;
      continueSoon = wakeMode === "processing" && plan.continueSoon;
      if (plan.ranges.some((range) => range.kind === "steady")) steadyPlanned = true;
      const plannedDays = plan.ranges.flatMap((range) => eachYmd(range.from, range.to));
      if (plannedDays.length) {
        deferred = journalDeferredDays(deferred, plannedDays);
        await saveHelperDeferredDays(deferred);
      }
      await saveHelperSyncState(state);
      if (!plan.due && !continueSoon) break;

      const batch = orderDaysForWake(plannedDays, today, yesterday).slice(0, remaining);
      for (const ymd of batch) {
        remaining -= 1;
        setKdpHelperRunning(true, `sync ${ymd}`);
        try {
          await syncOneDay(accountId, ymd, titlesJson, preferredCurrency);
          deferred = acknowledgeDeferredDays(deferred, [ymd]);
          totalDays += 1;
          if (ymd === today || ymd === yesterday) steadyOk = true;
        } catch (dayError) {
          lastSoftError = dayError instanceof Error ? dayError.message : String(dayError);
          if (isRateLimited(dayError)) await sleep(RATE_LIMIT_BACKOFF_MS);
        }
      }
      await saveHelperDeferredDays(deferred);
    }

    // Recover holes: incomplete nightly, leftover journal, or cloud gaps.
    if (state.onboardingDone) {
      const window = nightlyWindow(today);
      try {
        const holes = await cloudMissingDays(accountId, window.from, window.to);
        if (holes.length) {
          deferred = journalDeferredDays(deferred, holes);
          await saveHelperDeferredDays(deferred);
        }
      } catch {
        /* next wake retries */
      }
    }

    const queued = orderDaysForWake(deferred, today, yesterday).slice(0, Math.max(0, remaining));
    for (const ymd of queued) {
      setKdpHelperRunning(true, `deferred: ${ymd}`);
      try {
        await syncOneDay(accountId, ymd, titlesJson, preferredCurrency);
        deferred = acknowledgeDeferredDays(deferred, [ymd]);
        totalDays += 1;
        if (ymd === today || ymd === yesterday) steadyOk = true;
      } catch (dayError) {
        lastSoftError = dayError instanceof Error ? dayError.message : String(dayError);
        if (isRateLimited(dayError)) await sleep(RATE_LIMIT_BACKOFF_MS);
      }
    }
    await saveHelperDeferredDays(deferred);

    // planSync advances lastSteadyAtMs to throttle the in-tick loop. Revert when
    // today/yesterday never imported successfully so Sync does not claim "Completed".
    if (steadyPlanned && !steadyOk) {
      state = { ...state, lastSteadyAtMs: steadyAtBeforeTick };
    }

    if (totalDays > 0 || hasIncompleteNightly(state)) {
      state = { ...state, lastRunYmd: today, lastRunAtMs: Date.now() };
    }
    const nightlyBefore = state.lastNightlyYmd;
    state = sealNightlyIfClear(state, today, deferred);
    await saveHelperSyncState(state);
    if (state.lastNightlyYmd && state.lastNightlyYmd !== nightlyBefore) {
      void appendKdpActivity(
        `Night backfill completed ${state.lastNightlyYmd} · 30 days`,
        "nightly",
      );
    } else if (state.lastSteadyAtMs > 0 && totalDays > 0) {
      void appendKdpActivity(`15 min sync · imported ${totalDays} day(s)`, "steady");
    }

    const leftover = hasIncompleteNightly(state) || deferred.length > 0;
    const backlog = deferred.length ? ` · ${deferred.length} deferred` : "";
    const leftoverNote = leftover && !deferred.length ? " · nightly leftover" : "";
    const doneMessage = totalDays
      ? `Imported ${totalDays} day${totalDays === 1 ? "" : "s"}${backlog}${leftoverNote}`
      : leftover
        ? `Retry queued${backlog}`
        : "Up to date";
    setKdpHelperRunning(false, lastSoftError ? `${doneMessage} · ${lastSoftError}` : doneMessage);
    void appendKdpActivity(doneMessage, leftover ? "info" : "steady");
    void publishKdpSyncSnapshot({
      status: leftover ? "Retrying" : "Updated",
      detail: doneMessage,
      isActive: false,
      progress: leftover ? 0.85 : 1,
      completedAtMs: Date.now(),
    });
    void import("inteliads-native-sync")
      .then((m) => m.scheduleNativeMetronome(true))
      .catch(() => undefined);
    if (lastSoftError) {
      setKdpHelperError(lastSoftError);
      void appendKdpActivity(lastSoftError, "error");
    }
    return { ok: true, reason: leftover ? "synced_leftover" : "synced", days: totalDays, wakeMode };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    setKdpHelperError(message);
    setKdpHelperRunning(false, message);
    void appendKdpActivity(message, "error");
    void publishKdpSyncSnapshot({
      status: "Error",
      detail: message,
      isActive: false,
    });
    void import("inteliads-native-sync")
      .then((m) => m.scheduleNativeMetronome(true))
      .catch(() => undefined);
    return { ok: false, reason: message, wakeMode };
  }
}

export async function onKdpRoyaltySourceChanged(source: KdpRoyaltySource): Promise<void> {
  if (!isIosHelperEnabled(source)) {
    setKdpHelperRunning(false, "iPhone helper off");
    return;
  }
  try {
    const { ensureBackgroundRefreshRegistered } = await import("../notifications");
    await ensureBackgroundRefreshRegistered();
  } catch {
    /* registration is best-effort; tick still runs */
  }
  await runKdpIosHelperTick("enable", { force: true });
}
