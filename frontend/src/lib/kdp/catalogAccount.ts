import { supabase } from "../supabase.ts";
import { withKdpTaskRequest } from "./backgroundBudget.ts";

const PAGE_SIZE = 500;
const ACCOUNT_CHUNK = 100;
const normalizeAsin = (value: unknown): string | null => {
  const asin = String(value ?? "").trim().toUpperCase();
  return /^[A-Z0-9]{10}$/.test(asin) ? asin : null;
};

export class KdpCatalogAccountUnverified extends Error {
  readonly code: "catalog_missing" | "account_not_owned" | "account_conflict" | "catalog_no_overlap" | "initial_capture_required" | "catalog_lookup_failed";
  constructor(code: KdpCatalogAccountUnverified["code"]) {
    super(code === "account_conflict" || code === "catalog_no_overlap"
      ? "The signed-in KDP catalog does not match this import account. Open the helper and verify the selected account before syncing."
      : "KDP catalog identity could not be verified. Accepted data is preserved; open the helper to verify the account and retry.");
    this.name = "KdpCatalogAccountUnverified";
    this.code = code;
  }
}

/** Check the captured catalog before any catalog, price, or report write.
 * Existing overlap permits new titles and partial incremental title captures.
 * Foreground first capture initializes an owned empty destination; it is not
 * proof of Amazon Ads profile identity. Ads links need independent server proof.
 */
export async function assertCapturedKdpCatalogAccount(opts: {
  userId: string;
  accountId: string;
  capturedAsins: readonly unknown[];
  allowInitialCapture?: boolean;
  deadlineAtMs?: number;
}): Promise<{ catalogVerified: true; reason: "existing_catalog_overlap" | "initial_foreground_capture"; overlapCount: number; knownCatalogCount: number }> {
  const incoming = new Set(opts.capturedAsins.map(normalizeAsin).filter((asin): asin is string => asin != null));
  if (incoming.size === 0) throw new KdpCatalogAccountUnverified("catalog_missing");
  if (!opts.userId || !opts.accountId) throw new KdpCatalogAccountUnverified("account_not_owned");

  const ownedIds: string[] = [];
  const catalogs = new Map<string, Set<string>>();
  const readAll = async (build: (from: number, to: number) => any): Promise<any[]> => {
    const rows: any[] = [];
    let lastFullPage: string | undefined;
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const response = await withKdpTaskRequest(opts.deadlineAtMs, async (signal) => {
        const query = build(offset, offset + PAGE_SIZE - 1);
        return await (signal ? query.abortSignal(signal) : query);
      });
      if (response.error || !Array.isArray(response.data)) throw new KdpCatalogAccountUnverified("catalog_lookup_failed");
      const batch = response.data;
      if (batch.length === PAGE_SIZE) {
        const signature = JSON.stringify(batch);
        if (signature === lastFullPage) throw new KdpCatalogAccountUnverified("catalog_lookup_failed");
        lastFullPage = signature;
      }
      rows.push(...batch);
      if (batch.length < PAGE_SIZE) return rows;
    }
  };

  const accounts = await readAll((from, to) => supabase.from("kdp_accounts")
    .select("id").eq("user_id", opts.userId).order("id", { ascending: true }).range(from, to));
  for (const row of accounts) {
    const id = String(row.id ?? "").trim();
    if (id && !catalogs.has(id)) { ownedIds.push(id); catalogs.set(id, new Set()); }
  }
  if (!catalogs.has(opts.accountId)) throw new KdpCatalogAccountUnverified("account_not_owned");

  // Read complete owned title catalogs in bounded filters. There is no 1,000
  // row assumption, no pricing-only identity, and no reads of another user.
  for (let i = 0; i < ownedIds.length; i += ACCOUNT_CHUNK) {
    const ids = ownedIds.slice(i, i + ACCOUNT_CHUNK);
    const rows = await readAll((from, to) => supabase.from("kdp_titles")
      .select("account_id, asin").in("account_id", ids)
      .order("account_id", { ascending: true }).order("asin", { ascending: true }).range(from, to));
    for (const row of rows) {
      const catalog = catalogs.get(String(row.account_id ?? ""));
      const asin = normalizeAsin(row.asin);
      if (!catalog || !ids.includes(String(row.account_id ?? ""))) throw new KdpCatalogAccountUnverified("catalog_lookup_failed");
      if (asin) catalog.add(asin);
    }
  }

  const selected = catalogs.get(opts.accountId)!;
  let overlapCount = 0;
  for (const [id, catalog] of catalogs) {
    let overlaps = 0;
    for (const asin of incoming) if (catalog.has(asin)) overlaps += 1;
    if (id !== opts.accountId && overlaps > 0) throw new KdpCatalogAccountUnverified("account_conflict");
    if (id === opts.accountId) overlapCount = overlaps;
  }
  if (selected.size > 0 && overlapCount === 0) throw new KdpCatalogAccountUnverified("catalog_no_overlap");
  if (selected.size === 0 && (!opts.allowInitialCapture || opts.deadlineAtMs != null)) {
    throw new KdpCatalogAccountUnverified("initial_capture_required");
  }
  return { catalogVerified: true, reason: selected.size ? "existing_catalog_overlap" : "initial_foreground_capture",
    overlapCount, knownCatalogCount: selected.size };
}
