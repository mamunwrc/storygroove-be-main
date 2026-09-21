/**
 * Characters tab / export ordering.
 * `sortOrder` is unset until the writer reorders once — preserve natural order then.
 */

export function sortCharactersByUserOrder(characters = []) {
  const list = Array.isArray(characters) ? characters : [];
  const anyOrdered = list.some((c) => Number.isFinite(c?.sortOrder));
  if (!anyOrdered) return list;
  return [...list].sort((a, b) => {
    const ao = Number.isFinite(a?.sortOrder)
      ? a.sortOrder
      : Number.POSITIVE_INFINITY;
    const bo = Number.isFinite(b?.sortOrder)
      ? b.sortOrder
      : Number.POSITIVE_INFINITY;
    if (ao !== bo) return ao - bo;
    return String(a?.name || "").localeCompare(String(b?.name || ""));
  });
}

/**
 * Build a complete ordered id list: writer order first, then any missing ids.
 * Invalid / unknown / duplicate ids in `orderedIds` are skipped.
 */
export function buildCharacterOrderIds(existingIds = [], orderedIds = []) {
  const idSet = new Set(existingIds.map(String));
  const unique = [];
  const seen = new Set();
  for (const id of orderedIds) {
    const s = String(id);
    if (!idSet.has(s) || seen.has(s)) continue;
    seen.add(s);
    unique.push(s);
  }
  for (const id of existingIds) {
    const s = String(id);
    if (!seen.has(s)) unique.push(s);
  }
  return unique;
}
