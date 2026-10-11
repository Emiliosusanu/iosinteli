const ENTITY_COLLECTION_KEYS = [
  "rows",
  "items",
  "data",
  "pages",
  "keywords",
  "targets",
  "product_targets",
  "productTargets",
  "ad_groups",
  "adGroups",
  "campaigns",
] as const;

/** Patch an entity inside flat, `{ rows }`, and infinite `{ pages }` caches. */
export function patchEntityInQueryData<T>(
  value: T,
  entityId: string,
  patchRow: (row: any) => any,
): T {
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((entry) => {
      const patched = patchEntityInQueryData(entry, entityId, patchRow);
      changed ||= patched !== entry;
      return patched;
    });
    return (changed ? next : value) as T;
  }
  if (!value || typeof value !== "object") return value;

  const objectValue = value as Record<string, unknown>;
  if (objectValue.id != null && String(objectValue.id) === String(entityId)) {
    return patchRow(value) as T;
  }

  let changed = false;
  const next: Record<string, unknown> = { ...objectValue };
  for (const key of ENTITY_COLLECTION_KEYS) {
    if (!(key in objectValue) || objectValue[key] == null) continue;
    const patched = patchEntityInQueryData(objectValue[key], entityId, patchRow);
    if (patched !== objectValue[key]) {
      next[key] = patched;
      changed = true;
    }
  }
  return (changed ? next : value) as T;
}
