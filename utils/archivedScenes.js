/** Archived outline scenes stay in the DB but are hidden from Olivia; archive renumbers active slots. */

export const isArchivedScene = (uc) => Boolean(uc?.archivedAt);

export const withoutArchivedScenes = (rows = []) =>
  (rows || []).filter((uc) => !isArchivedScene(uc));

export const archivedSceneRefKey = (ref) => {
  if (!ref || ref.actNumber == null || ref.sceneIndex == null) return "";
  const act = Number(ref.actNumber);
  const scene = Number(ref.sceneIndex);
  if (!Number.isFinite(act) || !Number.isFinite(scene)) return "";
  return `${act}:${scene}`;
};

export const archivedSceneRefKeySet = (userContents = []) => {
  const set = new Set();
  for (const uc of userContents || []) {
    if (!isArchivedScene(uc)) continue;
    const key = archivedSceneRefKey(uc);
    if (key) set.add(key);
  }
  return set;
};

/** Drop SceneMemory / EpisodicEvent rows whose sceneRef matches an archived slot. */
export const excludeArchivedSceneRefs = (items = [], archivedKeys) => {
  if (!archivedKeys?.size) return items || [];
  return (items || []).filter(
    (item) => !archivedKeys.has(archivedSceneRefKey(item?.sceneRef || item))
  );
};

/** Last non-archived scene, preferring one with manuscript prose. */
export const pickLastFilledSceneRow = (rows = []) => {
  const active = withoutArchivedScenes(rows);
  if (!active.length) return null;
  const sorted = [...active].sort((a, b) => {
    if (a.actNumber !== b.actNumber) return b.actNumber - a.actNumber;
    return b.sceneIndex - a.sceneIndex;
  });
  const withContent = sorted.find(
    (r) => typeof r.userContent === "string" && r.userContent.trim().length > 0
  );
  return withContent || sorted[0];
};
