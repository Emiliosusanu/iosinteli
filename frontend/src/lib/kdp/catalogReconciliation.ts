type CatalogRow = { id?: unknown };

export function staleCatalogRowIds(
  existingIds: readonly string[],
  snapshotRows: readonly CatalogRow[],
): string[] {
  const current = new Set(
    snapshotRows.map((row) => String(row.id ?? "").trim()).filter(Boolean),
  );
  if (!current.size) return [];
  return [...new Set(existingIds.map((id) => String(id).trim()).filter(Boolean))]
    .filter((id) => !current.has(id));
}
