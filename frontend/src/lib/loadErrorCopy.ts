/** Consistent load-failure titles — never use "failed to load" in UI copy. */
export function couldntLoad(entity: string): string {
  const trimmed = entity.trim();
  if (!trimmed) return "Couldn't load this screen";
  const lower = trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
  return `Couldn't load ${lower}`;
}

export const LOAD_RETRY_SUBTITLE = "Try again in a moment.";
