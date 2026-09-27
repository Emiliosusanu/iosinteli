/** Coalesce a user's foreground financial refreshes and avoid repeat reads
 * from quick app-state transitions. Failed reads remain immediately retryable.
 */
export function createForegroundRefreshGate(cooldownMs = 60_000) {
  const slots = new Map<string, { lastSuccessAt: number; inFlight: Promise<void> | null }>();

  return async function run(
    ownerId: string,
    refresh: () => Promise<boolean>,
    force = false,
  ): Promise<void> {
    if (!ownerId) return;
    let slot = slots.get(ownerId);
    if (!slot) {
      slot = { lastSuccessAt: 0, inFlight: null };
      slots.set(ownerId, slot);
    }
    if (slot.inFlight) return slot.inFlight;
    if (!force && Date.now() - slot.lastSuccessAt < cooldownMs) return;

    const activeSlot = slot;
    const work = Promise.resolve().then(refresh).then((ok) => {
      if (ok) activeSlot.lastSuccessAt = Date.now();
    }).finally(() => {
      activeSlot.inFlight = null;
    });
    activeSlot.inFlight = work;
    return work;
  };
}
