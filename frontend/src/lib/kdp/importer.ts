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
import { AppState } from "react-native";
import { SHORT_PRICING_MAX_BOOKS, SHORT_WAKE_WORK_MS } from "./pricingCheckpoint.ts";
import { supabase } from "../supabase.ts";
import { resolveHelperAccountId } from "./accounts.ts";
import { orderDaysForWake, reopenOnboardingIfIncomplete } from "./coverage.ts";
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
  loadHelperSyncState,
  loadHelperTemplates,
  saveHelperAccountId,
  saveHelperDeferredDays,
  saveHelperReplayCurrency,
  saveHelperSyncState,
  saveHelperTemplates,
} from "./persist.ts";
import { appendKdpActivity } from "./activity.ts";
import { parseKdpJsonOrThrow, rebuildTemplateForDay } from "./replay.ts";
import {
  hasIncompleteNightly,
  ONBOARDING_DAYS,
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
import { isKdpHelperScreenFocused } from "./helperUi.ts";
import { getKdpRoyaltySource } from "./sourceStore.ts";
import { isIosHelperEnabled, type KdpRoyaltySource } from "./source.ts";
import { loadKdpWebSession } from "./session.ts";
import { KDP_CAPTURE_PAGES } from "./templates.ts";
import { writeKdpCatalog, writeKdpDay } from "./upsert.ts";
import {
  allKdpMarketplaceTargets,
  type KdpMarketplaceTarget,
} from "./marketplace.ts";
import { evaluateRoyaltyOverwriteSafety } from "./royaltyOverwriteSafety.ts";
import { createSingleFlight } from "./singleFlight.ts";
import { mapKdpMarketplacesSettled } from "./vendor/kdp-report-scheduler.js";
import { runShelfHeal } from "./runShelfHeal.ts";
import { syncKdpPaperbackPricing } from "./pricingSync.ts";
import { hydratePricingAuthBannerFromBootstrap } from "./pricingBootstrap.ts";
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
    const available = () => {
      const template = getKdpHelperStatus().templates[page.type];
      return !!template && (page.type !== "orders" || !/\/orders\/placed\//i.test(template.url));
    };
    if (available()) continue;
    setKdpHelperRunning(true, `Capturing ${page.type}…`);
    navigateKdpWebView(page.url);
    await waitUntil(available, CAPTURE_WAIT_MS);
  }
  await saveHelperTemplates(getKdpHelperStatus().templates);
  if (!kdpTemplatesReady()) {
    throw new Error("Could not capture KDP reports. Open royalties, orders, and KENP once while signed in.");
  }
}

async function fetchJsonForType(
  type: "royalties" | "orders" | "kenp" | "titles" | "titles_latest" | "royalties_titles",
  ymd: string,
  preferredCurrency: string | null = null,
  marketplace: KdpMarketplaceTarget | null = null,
) {
  const templates = getKdpHelperStatus().templates;
  // Captured title rows carry ASIN activity; marketplace overview rows do not.
  const template = type === "orders"
    ? (templates.orders_titles && !/\/orders\/placed\//i.test(templates.orders_titles.url)
      ? templates.orders_titles : templates.orders)
    : type === "kenp"
      ? templates.kenp_titles || templates.kenp
      : templates[type];
  if (!template) return null;
  if (type === "orders" && /\/orders\/placed\//i.test(template.url)) {
    throw new Error("Processed KDP orders need a fresh capture; existing activity preserved");
  }
  const req = rebuildTemplateForDay(template, type, ymd, { preferredCurrency, marketplace });
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
      throw retryError;
    }
  }
}

async function fetchDayPayloads(
  ymd: string,
  currency: "EUR" | "USD" | string,
  marketplace: KdpMarketplaceTarget | null,
): Promise<{ royaltiesJson: unknown; ordersJson: unknown; kenpJson: unknown }> {
  const results = await Promise.allSettled([
    fetchJsonForType("royalties", ymd, currency, marketplace),
    fetchJsonForType("orders", ymd, currency, marketplace),
    fetchJsonForType("kenp", ymd, currency, marketplace),
  ]);
  // Wait for all siblings before a failed day is retried by another wake.
  const failed = results.find((result) => result.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
  const [royaltiesJson, ordersJson, kenpJson] = results.map((result) =>
    result.status === "fulfilled" ? result.value : null);
  if (!royaltiesJson || !ordersJson || !kenpJson) {
    const scope = marketplace?.key || "ALL";
    throw new Error(`Incomplete KDP ${scope} response for ${ymd}; existing data was preserved`);
  }
  return { royaltiesJson, ordersJson, kenpJson };
}

async function syncOneDay(
  accountId: string,
  ymd: string,
  titlesJson: unknown,
  marketplaceTargets: KdpMarketplaceTarget[],
): Promise<void> {
  // The authoritative All rollup is always USD. Native storefront requests
  // below populate kdp_daily_facts without changing the account/day total.
  const { royaltiesJson, ordersJson, kenpJson } = await fetchDayPayloads(ymd, "USD", null);
  const built = buildKdpFromJsons({
    ymd,
    titlesJson,
    royaltiesJson,
    ordersJson,
    kenpJson,
    adsJson: null,
    adsEntityId: null,
  });
  built.rowEntry.income_currency = "USD";

  const { data: previous, error: previousError } = await supabase
    .from("kdp_daily_data")
    .select("royalties,orders,kenp")
    .eq("account_id", accountId)
    .eq("date", ymd)
    .maybeSingle();
  if (previousError) {
    throw new Error(`Could not load accepted KDP baseline for ${ymd}; refusing overwrite`);
  }
  const overwriteSafety = evaluateRoyaltyOverwriteSafety({ previous, incoming: built.rowDaily });

  const isEstimated = ymd >= new Date().toISOString().slice(0, 10);
  const factRows: Array<Record<string, unknown>> = [];
  const appendFacts = (
    rows: Array<Record<string, unknown>>,
    marketplace: string,
    currency: string,
  ) => {
    for (const fact of rows) {
      const asin = String(fact.asin || "").trim().toUpperCase();
      const format = String(fact.format || "").trim().toLowerCase();
      if (!asin || !format) continue;
      factRows.push({
        asin,
        format,
        marketplace,
        currency,
        units: Math.max(0, Math.trunc(Number(fact.units || 0))),
        royalties: Number(fact.royalties || 0),
        kenp: Math.max(0, Math.trunc(Number(fact.kenp || 0))),
        is_estimated: isEstimated,
      });
    }
  };

  if (marketplaceTargets.length) {
    // Keep three stores active without a fixed-batch barrier. On failure stop
    // new work and drain active requests before deferring the whole day.
    const started = Date.now();
    const native = await mapKdpMarketplacesSettled(marketplaceTargets,
      async (target) => {
        const payloads = await fetchDayPayloads(ymd, target.currency, target);
        const result = buildKdpFromJsons({
          ymd,
          titlesJson,
          ...payloads,
          adsJson: null,
          adsEntityId: null,
        });
        return { target, facts: result.facts as Array<Record<string, unknown>> };
      }, { concurrency: 3, pauseMs: 0, stopOnFailure: true });
    await appendKdpActivity(`Marketplace capture ${ymd} · ${marketplaceTargets.length} stores`, "info", {
      stage: "marketplaces", ymd, concurrency: 3, durationMs: Date.now() - started,
      stores: native.map((result, index) => ({
        marketplace: marketplaceTargets[index].key, currency: marketplaceTargets[index].currency,
        durationMs: result.durationMs, ok: result.status === "fulfilled", skipped: result.skipped === true,
      })),
    });
    const failed = native.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
    for (const result of native) {
      if (result.status === "fulfilled") appendFacts(result.value.facts, result.value.target.key, result.value.target.currency);
    }
  } else {
    appendFacts(
      built.facts as Array<Record<string, unknown>>,
      "ALL",
      "USD",
    );
  }

  if (!overwriteSafety.safe) {
    // All requested source reports have succeeded. Keep the complete capture
    // as a review candidate; this endpoint cannot replace accepted data.
    try {
      await writeKdpDay({ accountId, rowDaily: built.rowDaily, rowEntry: built.rowEntry,
        rowsBookDaily: built.rowsBookDaily, factRows, reviewOnly: true,
        marketplaces: marketplaceTargets.map((target) => target.key) });
      void appendKdpActivity(`Protected ${ymd}: correction saved for administrator verification`, "error");
    } catch {
      void appendKdpActivity(`Protected ${ymd}: correction pending; review upload will retry`, "error");
    }
    throw new Error(`Protected ${ymd}: existing verified royalties and activity preserved`);
  }

  await writeKdpDay({
    accountId,
    rowDaily: built.rowDaily,
    rowEntry: built.rowEntry,
    rowsBookDaily: built.rowsBookDaily,
    factRows,
    marketplaces: marketplaceTargets.map((target) => target.key),
  });
}

async function resolveAccountId(userId: string, profileIds: string[]): Promise<string> {
  const cached = await loadHelperAccountId();
  if (cached) {
    const { data: owned } = await supabase
      .from("kdp_accounts")
      .select("id")
      .eq("id", cached)
      .eq("user_id", userId)
      .maybeSingle();
    if (owned?.id) return cached;
  }
  const resolved = await resolveHelperAccountId({ userId, profileIds });
  await saveHelperAccountId(resolved.accountId);
  if (resolved.name) {
    setKdpHelperRunning(true, `Using KDP account “${resolved.name}”`);
  }
  return resolved.accountId;
}

// AppState, silent push, native wake and the manual button can arrive together.
// They must share one report/pricing pass and one planner journal update.
export const runKdpIosHelperTick = createSingleFlight(runKdpIosHelperTickOnce);

async function runKdpIosHelperTickOnce(
  reason: string,
  opts: { force?: boolean; profileIds?: string[]; wakeMode?: KdpWakeMode } = {},
): Promise<{ ok: boolean; skipped?: boolean; reason: string; days?: number; wakeMode?: KdpWakeMode }> {
  const tickStartedAtMs = Date.now();
  // Background / resume ticks must not navigate the sign-in WebView.
  // Once signed in, Keychain replay can continue 90-day leftover in-place.
  if (isKdpHelperScreenFocused() && reason !== "manual" && !getKdpHelperStatus().loggedIn) {
    return { ok: true, skipped: true, reason: "helper_ui_focused" };
  }

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
  const deliveredWakeMode = wakeMode;

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
    // Restore a prior print-pricing step-up independently from Reports auth.
    // This keeps the price gate visible after process death without labelling
    // the valid royalties session as signed out.
    void hydratePricingAuthBannerFromBootstrap(accountId);

    // A KDP account can earn royalties where it has no Ads profile. Always
    // fetch every Reports storefront before replacing its native day facts.
    const preferredCurrency = "USD" as const;
    const marketplaceTargets = allKdpMarketplaceTargets();
    await saveHelperReplayCurrency(preferredCurrency);
    setKdpHelperRunning(true, `KDP replay currency ${preferredCurrency}`);
    void appendKdpActivity(
      `Replay currency USD · ${marketplaceTargets.length || 1} marketplace scope(s)`,
      "currency",
    );

    const titlesYmd = new Date().toISOString().slice(0, 10);
    const titlesJson =
      (await fetchJsonForType("titles", titlesYmd, preferredCurrency).catch(() => null)) ||
      (await fetchJsonForType("titles_latest", titlesYmd, preferredCurrency).catch(() => null)) ||
      (await fetchJsonForType("royalties_titles", titlesYmd, preferredCurrency).catch(() => null));
    let pricingBooksObj: Record<string, unknown> | null = null;
    let pricingFormatRows: Record<string, unknown>[] = [];
    if (titlesJson) {
      pricingBooksObj = extractBooksObj(titlesJson) as Record<string, unknown>;
      const shelf = buildTitlesRows({ accountId, booksObj: pricingBooksObj });
      pricingFormatRows = shelf.formatRows as Record<string, unknown>[];
      await writeKdpCatalog({
        accountId,
        bookRows: shelf.bookRows,
        formatRows: shelf.formatRows,
        titleRows: shelf.titleRows,
      });
      await runShelfHeal({
        userId,
        liveHelperAccountId: accountId,
        liveHelperCatalogAsins: shelf.formatRows.map((row) => String(row.asin || "")),
        pauseFullyQuarantinedJoins: false,
      });
    }

    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    let state: KdpSyncState = await loadHelperSyncState();
    let deferred = await loadHelperDeferredDays();
    const today = ymdInTz(new Date(), tz);
    const yesterday = addDaysYmd(today, -1);

    // Always reconcile last-90 coverage. A phone that sealed onboarding after
    // 45 Chrome days must reopen and finish the leftover.
    const history = await cloudHistorySealsOnboarding(accountId, today);
    const wasOnboarded = state.onboardingDone;
    state = reopenOnboardingIfIncomplete(state, history);
    if (history.sealed && !wasOnboarded) {
      const histMsg = `Web history complete (${history.dayCount} days) — skipping 30→90 backfill`;
      setKdpHelperRunning(true, histMsg);
      void appendKdpActivity(histMsg, "onboarding");
    } else if (history.missingHistorical.length) {
      deferred = journalDeferredDays(deferred, history.missingHistorical);
      await saveHelperDeferredDays(deferred);
      const holeMsg = `Last-90 leftover · ${history.missingHistorical.length} day(s) to import`;
      setKdpHelperRunning(true, holeMsg);
      void appendKdpActivity(holeMsg, "onboarding");
    }
    await saveHelperSyncState(state);
    if (!state.onboardingDone) wakeMode = "processing";

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
          await syncOneDay(accountId, ymd, titlesJson, marketplaceTargets);
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

    // Recover last-90 holes on every wake — never abandon leftover days.
    try {
      const floor90 = addDaysYmd(today, -(ONBOARDING_DAYS - 1));
      const holes90 = await cloudMissingDays(accountId, floor90, yesterday);
      if (holes90.length) {
        deferred = journalDeferredDays(deferred, holes90);
        await saveHelperDeferredDays(deferred);
      }
    } catch {
      /* next wake retries */
    }

    const queued = orderDaysForWake(deferred, today, yesterday).slice(0, Math.max(0, remaining));
    for (const ymd of queued) {
      setKdpHelperRunning(true, `deferred: ${ymd}`);
      try {
        await syncOneDay(accountId, ymd, titlesJson, marketplaceTargets);
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

    const leftover = !state.onboardingDone || hasIncompleteNightly(state) || deferred.length > 0;
    const backlog = deferred.length ? ` · ${deferred.length} deferred` : "";
    const leftoverNote =
      leftover && !deferred.length
        ? state.onboardingDone
          ? " · nightly leftover"
          : " · last-90 leftover"
        : "";
    const reportsMessage = totalDays
      ? `Imported ${totalDays} day${totalDays === 1 ? "" : "s"}${backlog}${leftoverNote}`
      : leftover
        ? `Retry queued${backlog}`
        : "Up to date";

    // Paperback list price, printing cost, royalty and BE ACoS share the same
    // account id and exact ASIN catalog as the report import above. Fresh rows
    // are skipped for one 15-minute metronome interval; pricing-page saves
    // mark only that setup id dirty, so a normal Import never rewrites every
    // unchanged book.
    let pricingMessage = "";
    let pricingPending = 0;
    let pricingAuthBlocked = false;
    let pricingRetryQueued = false;
    const shortBackgroundWake = AppState.currentState !== "active" && deliveredWakeMode === "recent";
    try {
      setKdpHelperRunning(true, "Checking paperback pricing…");
      const pricing = await syncKdpPaperbackPricing({
        accountId,
        titlesJson,
        booksObj: pricingBooksObj,
        formatRows: pricingFormatRows,
        maxBooks: shortBackgroundWake ? SHORT_PRICING_MAX_BOOKS : undefined,
        deadlineAtMs: shortBackgroundWake ? tickStartedAtMs + SHORT_WAKE_WORK_MS : undefined,
        onboarding: !state.onboardingDone || wakeMode === "processing",
        // Only an open helper is allowed to show Amazon's one-time pricing
        // step-up. Background wakes remain read-only and never navigate.
        allowAuthNavigate: isKdpHelperScreenFocused(),
      });
      pricingPending = Number(pricing.pending || 0);
      pricingAuthBlocked = Boolean(pricing.authRequired);
      if (pricing.authRequired) {
        pricingMessage = " · pricing login required";
      } else if (pricing.synced > 0) {
        pricingMessage = pricingPending
          ? ` · priced ${pricing.synced} · ${pricingPending} left`
          : ` · priced ${pricing.synced}`;
      } else if (pricingPending > 0) {
        pricingMessage = ` · pricing ${pricingPending} left`;
      }
    } catch (pricingError) {
      const message = pricingError instanceof Error ? pricingError.message : String(pricingError);
      pricingRetryQueued = true;
      pricingMessage = " · pricing retry queued";
      void appendKdpActivity(`KDP pricing retry queued · ${message}`, "info");
    }

    const pricingLeftover = pricingPending > 0 && !pricingAuthBlocked;
    const anyLeftover = leftover || pricingLeftover || pricingRetryQueued || Boolean(lastSoftError);
    const doneMessage = `${reportsMessage}${pricingMessage}`;
    setKdpHelperRunning(false, lastSoftError ? `${doneMessage} · ${lastSoftError}` : doneMessage);
    void appendKdpActivity(doneMessage, anyLeftover ? "info" : "steady");
    void publishKdpSyncSnapshot({
      status: pricingAuthBlocked ? "Action required" : anyLeftover ? "Retrying" : "Updated",
      detail: doneMessage,
      isActive: false,
      progress: pricingAuthBlocked ? 0.9 : anyLeftover ? 0.85 : 1,
      completedAtMs: anyLeftover || pricingAuthBlocked ? undefined : Date.now(),
    });
    void import("inteliads-native-sync")
      .then((m) => m.scheduleNativeMetronome(true))
      .catch(() => undefined);
    if (lastSoftError) {
      setKdpHelperError(lastSoftError);
      void appendKdpActivity(lastSoftError, "error");
    }
    return {
      ok: true,
      reason: pricingAuthBlocked
        ? "pricing_auth_required"
        : anyLeftover
          ? "synced_leftover"
          : "synced",
      days: totalDays,
      wakeMode,
    };
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
