/**
 * Resolve the narrative focus scene for an Olivia chat turn (editor + scene).
 */

import UserContent from "../models/userContentModel.js";
import { getLayeringStateForNovel } from "./oliviaLayeringState.js";
import {
  isArchivedScene,
  pickLastFilledSceneRow,
} from "../utils/archivedScenes.js";
import mongoose from "mongoose";

const normalizeFocusScene = (raw) => {
  if (!raw || raw.actNumber == null || raw.sceneIndex == null) return null;
  const actNumber = Number(raw.actNumber);
  const sceneIndex = Number(raw.sceneIndex);
  if (!Number.isFinite(actNumber) || !Number.isFinite(sceneIndex)) return null;
  if (actNumber < 1 || actNumber > 3 || sceneIndex < 1 || sceneIndex > 15) return null;
  const global = Number(raw.globalSceneNumber);
  return {
    actNumber,
    sceneIndex,
    ...(Number.isFinite(global) && global > 0 ? { globalSceneNumber: global } : {}),
  };
};

const layeringTargetToFocus = (target) => {
  if (target?.actNumber == null) return null;
  const actNumber = Number(target.actNumber);
  if (!Number.isFinite(actNumber)) return null;
  const after = Number(target.afterSceneIndex ?? 0);
  const sceneIndex = after + 1;
  return normalizeFocusScene({ actNumber, sceneIndex });
};

const findLastFilledScene = async (novelId, userId) => {
  const rows = await UserContent.find({ novelId, user: userId })
    .select("actNumber sceneIndex userContent archivedAt")
    .lean();
  const pick = pickLastFilledSceneRow(rows);
  if (!pick) return null;
  return normalizeFocusScene({
    actNumber: pick.actNumber,
    sceneIndex: pick.sceneIndex,
  });
};

const isArchivedFocusSlot = async (novelId, userId, focus) => {
  if (!focus || !novelId || !userId) return false;
  if (mongoose.connection.readyState !== 1) return false;
  try {
    const row = await UserContent.findOne({
      novelId,
      user: userId,
      actNumber: focus.actNumber,
      sceneIndex: focus.sceneIndex,
    })
      .select("archivedAt")
      .lean();
    return isArchivedScene(row);
  } catch {
    return false;
  }
};

/**
 * @param {Object} args
 * @param {string} args.novelId
 * @param {string} args.userId
 * @param {{ actNumber: number, sceneIndex: number } | null} args.explicitTargetScene
 * @param {import('mongoose').LeanDocument|null} args.activeSceneState
 * @returns {Promise<{ actNumber: number, sceneIndex: number } | null>}
 */
export const resolveFocusScene = async ({
  novelId,
  userId,
  explicitTargetScene = null,
  activeSceneState = null,
}) => {
  const explicit = normalizeFocusScene(explicitTargetScene);
  if (explicit && !(await isArchivedFocusSlot(novelId, userId, explicit))) {
    return explicit;
  }

  const fromActive = normalizeFocusScene(activeSceneState?.currentScene);
  if (fromActive && !(await isArchivedFocusSlot(novelId, userId, fromActive))) {
    return fromActive;
  }

  try {
    const layering = await getLayeringStateForNovel(novelId, userId);
    const fromLayering = layeringTargetToFocus(layering?.nextLayeringTarget);
    if (fromLayering && !(await isArchivedFocusSlot(novelId, userId, fromLayering))) {
      return fromLayering;
    }
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: "oliviaFocusResolver",
        op: "layeringState",
        novelId: String(novelId),
        error: err?.message || String(err),
      })
    );
  }

  return findLastFilledScene(novelId, userId);
};
