/** Coordinate native prompts across mounted tabs and asynchronous memory writes. */
export function createRoyaltySetupPromptGate() {
  let active: symbol | null = null;
  const shown = new Map<string, Set<string>>();
  return {
    acquire(owner: string | null | undefined, kind: string, automatic = true): (() => void) | null {
      if (!owner || !kind || active) return null;
      if (automatic && shown.get(owner)?.has(kind)) return null;
      const ticket = Symbol(kind);
      active = ticket;
      if (automatic) {
        const kinds = shown.get(owner) ?? new Set<string>();
        kinds.add(kind);
        shown.set(owner, kinds);
      }
      return () => { if (active === ticket) active = null; };
    },
  };
}

export const royaltySetupPromptGate = createRoyaltySetupPromptGate();
