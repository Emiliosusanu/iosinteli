export type KdpRoyaltySnapshot = {
  royalties?: number | null;
  orders?: number | null;
  units?: number | null;
  kenp?: number | null;
};

/** Refuse the VPS1/Levopppc failure shape while permitting real activity corrections. */
export function evaluateRoyaltyOverwriteSafety(input: {
  previous?: KdpRoyaltySnapshot | null;
  incoming?: KdpRoyaltySnapshot | null;
}): { safe: boolean; reason: string } {
  const number = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0);
  const integer = (value: unknown) => Math.max(0, Math.trunc(number(value)));
  const previousRoyalties = number(input.previous?.royalties);
  const incomingRoyalties = number(input.incoming?.royalties);
  const previousOrders = integer(input.previous?.orders ?? input.previous?.units);
  const incomingOrders = integer(input.incoming?.orders ?? input.incoming?.units);
  const previousKenp = integer(input.previous?.kenp);
  const incomingKenp = integer(input.incoming?.kenp);

  if ((previousRoyalties > 0.009 || previousOrders > 0 || previousKenp > 0)
    && incomingRoyalties <= 0.009 && incomingOrders === 0 && incomingKenp === 0) {
    return { safe: false, reason: "positive_snapshot_all_zero" };
  }

  const royaltiesStable = previousRoyalties > 0.009 && Math.abs(incomingRoyalties - previousRoyalties) <= 0.009;
  if (royaltiesStable && previousOrders > 0 && incomingOrders === 0) {
    return { safe: false, reason: "stable_royalties_zero_orders" };
  }
  if (royaltiesStable && previousKenp > 0 && incomingKenp === 0) {
    return { safe: false, reason: "stable_royalties_zero_kenp" };
  }

  if (previousRoyalties <= 0.009 || incomingRoyalties >= previousRoyalties) {
    return { safe: true, reason: "no_positive_regression" };
  }
  if (previousOrders !== incomingOrders || previousKenp !== incomingKenp) {
    return { safe: true, reason: "activity_changed" };
  }
  if (incomingRoyalties <= 0.009) {
    return { safe: false, reason: "stable_activity_zero_royalties" };
  }
  if (previousRoyalties >= 1 && incomingRoyalties < previousRoyalties * 0.2) {
    return { safe: false, reason: "stable_activity_severe_royalty_drop" };
  }
  return { safe: true, reason: "plausible_royalty_correction" };
}
