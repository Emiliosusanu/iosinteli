type AdGroupCreationResult = {
  adGroup: { state?: unknown };
  keywordCount?: unknown;
  productTargetCount?: unknown;
};

/** Creation intent and selected rows are not confirmation of activation or count. */
export function adGroupCreationNotice(
  result: AdGroupCreationResult,
  targeting: string,
): { title: string; message: string } {
  const state = typeof result.adGroup.state === "string"
    ? result.adGroup.state.trim().toLowerCase()
    : "";
  const title = state === "paused" ? "Ad group created paused" : "Ad group created";
  const status = state === "paused"
    ? "Ad group is paused."
    : state === "enabled"
      ? "Ad group is enabled."
      : "Status not confirmed. Open the ad group to check.";
  if (targeting !== "keywords" && targeting !== "products") return { title, message: status };
  const count = targeting === "keywords" ? result.keywordCount : result.productTargetCount;
  const label = targeting === "keywords" ? "keyword" : "product target";
  const detail = typeof count === "number" && Number.isSafeInteger(count) && count >= 0
    ? `Added ${count} ${label}${count === 1 ? "" : "s"}.`
    : `${targeting === "keywords" ? "Keyword" : "Product target"} count not confirmed.`;
  return { title, message: `${status} ${detail}` };
}
