/**
 * iPhone KDP helper orchestrator.
 *
 * Same tables and cadence as the Chrome extension:
 *   today + yesterday every ~15 min, 90-day onboarding in 14-day chunks,
 *   nightly last-30-day correction, gap fill after missed days.
 */
import { supabase } from "../supabase.ts";
import { resolveHelperAccountId } from "./accounts.ts";
import { eachYmd } from "./dates.ts";
import {
  loadHelperAccountId,
  loadHelperSyncState,
  loadHelperTemplates,
  saveHelperAccountId,
  saveHelperSyncState,
  saveHelperTemplates,
} from "./persist.ts";
import { planSync, type KdpSyncState } from "./planner.ts";
import { parseKdpJsonOrThrow, rebuildTemplateForDay } from "./replay.ts";
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
import { KDP_CAPTURE_PAGES } from "./templates.ts";
import { writeKdpCatalog, writeKdpDay } from "./upsert.ts";
import { buildKdpFromJsons, buildTitlesRows, extractBooksObj } from "./vendor/kdpVendor.generated.js";

const CAPTURE_WAIT_MS = 28_000;
const LOGIN_WAIT_MS = 8_000;
const WEBVIEW_ATTACH_WAIT_MS = 12_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    return data.session?.user?.id ?? null;
  } catch {
    return null;
  }
}

async function ensureTemplates(): Promise<void> {
  const persisted = await loadHelperTemplates();
  hydrateKdpTemplates(persisted);
  if (kdpTemplatesReady()) return;

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
) {
  const template = getKdpHelperStatus().templates[type];
  if (!template) return null;
  const req = rebuildTemplateForDay(template, type, ymd);
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
  return parseKdpJsonOrThrow(result, type);
}

async function syncOneDay(accountId: string, ymd: string, titlesJson: unknown): Promise<void> {
  const royaltiesJson = await fetchJsonForType("royalties", ymd);
  const ordersJson = await fetchJsonForType("orders", ymd);
  const kenpJson = await fetchJsonForType("kenp", ymd);
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

export async function runKdpIosHelperTick(
  reason: string,
  opts: { force?: boolean; profileIds?: string[] } = {},
): Promise<{ ok: boolean; skipped?: boolean; reason: string; days?: number }> {
  if (!isIosHelperEnabled(await getKdpRoyaltySource())) {
    return { ok: true, skipped: true, reason: "source_off" };
  }

  const userId = await currentUserId();
  if (!userId) return { ok: false, skipped: true, reason: "signed_out" };

  try {
    setKdpHelperRunning(true, reason === "enable" ? "Starting iPhone helper…" : "Syncing KDP…");
    setKdpHelperError(null);

    await waitUntil(() => getKdpHelperStatus().ready, LOGIN_WAIT_MS);
    await ensureTemplates();

    const accountId =
      (await loadHelperAccountId()) ||
      (await resolveHelperAccountId({ userId, profileIds: opts.profileIds ?? [] }));
    await saveHelperAccountId(accountId);

    const titlesYmd = new Date().toISOString().slice(0, 10);
    const titlesJson =
      (await fetchJsonForType("titles", titlesYmd).catch(() => null)) ||
      (await fetchJsonForType("titles_latest", titlesYmd).catch(() => null)) ||
      (await fetchJsonForType("royalties_titles", titlesYmd).catch(() => null));
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
    let totalDays = 0;
    let guard = 0;
    let continueSoon = true;

    while (continueSoon && guard < 16) {
      guard += 1;
      const plan = planSync(new Date(), state, { timeZone: tz, force: opts.force && guard === 1 });
      state = plan.nextState;
      continueSoon = plan.continueSoon;
      if (!plan.due) break;
      for (const range of plan.ranges) {
        const days = eachYmd(range.from, range.to);
        for (const ymd of days) {
          setKdpHelperRunning(true, `${range.kind}: ${ymd}`);
          await syncOneDay(accountId, ymd, titlesJson);
          totalDays += 1;
        }
      }
      await saveHelperSyncState(state);
    }

    setKdpHelperRunning(false, totalDays ? `Imported ${totalDays} day${totalDays === 1 ? "" : "s"}` : "Up to date");
    return { ok: true, reason: "synced", days: totalDays };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    setKdpHelperError(message);
    setKdpHelperRunning(false, message);
    return { ok: false, reason: message };
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
