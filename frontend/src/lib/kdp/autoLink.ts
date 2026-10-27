import { nestApiJson, resolveHelperUserId } from "../rulesApi.ts";

/** A successful financial ACK is a prerequisite, never evidence of Ads identity. */
export async function autoLinkKdpProfilesAfterCapture(opts: {
  userId: string;
  accountId: string;
  catalogAsins: readonly string[];
  catalogVerified: boolean;
  acknowledgedDays: number;
  deadlineAtMs?: number;
}): Promise<{ ok: boolean; skipped?: boolean; reason: string; linked?: number }> {
  // Keep optional attribution work outside the entire short background budget.
  if (opts.deadlineAtMs != null) return { ok: true, skipped: true, reason: "background_deferred" };
  const hasCatalog = opts.catalogAsins.some((asin) => /^[A-Z0-9]{10}$/.test(String(asin || "").trim().toUpperCase()));
  if (!opts.userId || !opts.accountId || !opts.catalogVerified || !hasCatalog
    || !Number.isInteger(opts.acknowledgedDays) || opts.acknowledgedDays <= 0) {
    return { ok: true, skipped: true, reason: "capture_not_verified" };
  }
  try {
    if (await resolveHelperUserId() !== opts.userId) {
      return { ok: true, skipped: true, reason: "identity_changed" };
    }
    // The server examines owned catalogs and sponsored ASINs independently.
    // Never send the user's selected profiles as a proposed attribution.
    const result = await nestApiJson<{ linked?: unknown[]; skipped?: unknown[] }>(
      "/setup/auto-link", { method: "POST" }, "KDP profile linking will retry.",
    );
    if (!Array.isArray(result?.linked) || !Array.isArray(result?.skipped)) {
      return { ok: false, reason: "linking_not_confirmed" };
    }
    return { ok: true, reason: "server_asin_proof", linked: result.linked.length };
  } catch {
    // This optional failure must not invalidate acknowledged report/pricing data.
    return { ok: false, reason: "linking_retry" };
  }
}
