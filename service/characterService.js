/**
 * Character upsert + manual create. Forward-only multi-lead:
 * new inserts may be protagonist/antagonist even when another lead exists.
 * Existing Character documents are never reclassified by this module.
 */
import mongoose from "mongoose";
import Novel from "../models/novelModel.js";
import Character from "../models/characterModel.js";
import {
  buildManualCharacterDossierTemplate,
  castTypeAccordionLabel,
  normalizeManualCharacterType,
} from "../utils/characterDossierTemplate.js";
import { isOliviaMemoryV2Enabled } from "../constants/oliviaMemory.js";
import {
  onCharacterEdit as memoryOnCharacterEdit,
  onCharacterDelete as memoryOnCharacterDelete,
} from "./memoryInvalidator.js";
import { queueActivityLog } from "../utils/queueActivityLog.js";

const MAX_CHARACTER_NAME_LENGTH = 120;

export class CharacterServiceError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "CharacterServiceError";
    this.statusCode = statusCode;
  }
}

const namesMatch = (a, b) =>
  String(a || "")
    .trim()
    .toLowerCase() ===
  String(b || "")
    .trim()
    .toLowerCase();

/**
 * Upsert a parsed dossier by { novel, name, character type }.
 * Multiple protagonists/antagonists are allowed (no slot demotion).
 * Used by Olivia novel creation and missing-dossier lazy heal only.
 *
 * @param {string} novelId
 * @param {{ name: string, roleInStory?: string, characterType?: string, dossierText?: string }} entry
 * @param {{ Character?: typeof Character }} [deps]
 */
export const safeUpsertDossierCharacter = async (novelId, entry, deps = {}) => {
  if (!entry?.name) return null;
  const CharacterModel = deps.Character || Character;
  const targetType = normalizeManualCharacterType(entry.characterType);
  const name = String(entry.name).trim();

  return CharacterModel.findOneAndUpdate(
    { novel: novelId, name, character: targetType },
    {
      name,
      character: targetType,
      role: entry.roleInStory,
      responseText: entry.dossierText,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

export const findDuplicateCharacterByName = (characters, name) => {
  const needle = String(name || "")
    .trim()
    .toLowerCase();
  if (!needle) return null;
  return (
    (characters || []).find(
      (c) =>
        String(c.name || "")
          .trim()
          .toLowerCase() === needle
    ) || null
  );
};

/**
 * Insert a new Character with a seeded 17-point dossier. Never upserts.
 *
 * @param {{ novelId: string, userId: string, name: string, role?: string, characterType?: string, req?: object }} params
 * @param {{ Novel?: typeof Novel, Character?: typeof Character }} [deps]
 * @returns {Promise<{ character: object }>}
 */
export const createManualCharacter = async (
  { novelId, userId, name, role, characterType, req },
  deps = {}
) => {
  const NovelModel = deps.Novel || Novel;
  const CharacterModel = deps.Character || Character;
  const logActivity = deps.queueActivityLog || queueActivityLog;
  const memoryEnabled =
    typeof deps.isOliviaMemoryV2Enabled === "function"
      ? deps.isOliviaMemoryV2Enabled
      : isOliviaMemoryV2Enabled;
  const onCharacterEdit = deps.memoryOnCharacterEdit || memoryOnCharacterEdit;

  if (!mongoose.Types.ObjectId.isValid(novelId)) {
    throw new CharacterServiceError("Invalid novelId", 400);
  }

  const trimmedName = String(name || "").trim();
  if (!trimmedName) {
    throw new CharacterServiceError("Character name is required", 400);
  }
  if (trimmedName.length > MAX_CHARACTER_NAME_LENGTH) {
    throw new CharacterServiceError(
      `Character name must be ${MAX_CHARACTER_NAME_LENGTH} characters or fewer`,
      400
    );
  }

  const novel = await NovelModel.findOne({ _id: novelId, user: userId })
    .select("_id")
    .lean();
  if (!novel) {
    throw new CharacterServiceError("Novel not found", 404);
  }

  const existing = await CharacterModel.find({ novel: novelId })
    .select("name")
    .lean();
  if (findDuplicateCharacterByName(existing, trimmedName)) {
    throw new CharacterServiceError(
      "A character with this name already exists",
      409
    );
  }

  const resolvedType = normalizeManualCharacterType(characterType);
  const roleInStory = String(role || "").trim();
  const dossierText = buildManualCharacterDossierTemplate({
    name: trimmedName,
    roleInStory,
    characterType: resolvedType,
  });

  const character = await CharacterModel.create({
    novel: novelId,
    name: trimmedName,
    character: resolvedType,
    role: roleInStory || castTypeAccordionLabel(resolvedType),
    responseText: dossierText,
  });

  logActivity({
    req,
    userId,
    action: "create",
    module: "novel",
    description: "Character dossier created manually",
    metadata: {
      novelId: String(novelId),
      characterId: String(character._id),
      characterType: resolvedType,
    },
  });

  if (memoryEnabled()) {
    onCharacterEdit({
      novelId: String(novelId),
      characterId: String(character._id),
    });
  }

  return { character };
};

/**
 * Hard-delete a Character the writer owns. Cascades Olivia memory via
 * `onCharacterDelete` so the assembler does not keep a ghost name.
 *
 * @param {{ characterId: string, userId: string, req?: object }} params
 * @returns {Promise<{ characterId: string, novelId: string }>}
 */
export const deleteCharacter = async (
  { characterId, userId, req },
  deps = {}
) => {
  const NovelModel = deps.Novel || Novel;
  const CharacterModel = deps.Character || Character;
  const logActivity = deps.queueActivityLog || queueActivityLog;
  const memoryEnabled =
    typeof deps.isOliviaMemoryV2Enabled === "function"
      ? deps.isOliviaMemoryV2Enabled
      : isOliviaMemoryV2Enabled;
  const onDelete = deps.memoryOnCharacterDelete || memoryOnCharacterDelete;

  if (!mongoose.Types.ObjectId.isValid(characterId)) {
    throw new CharacterServiceError("Invalid characterId", 400);
  }

  const character = await CharacterModel.findById(characterId);
  if (!character) {
    throw new CharacterServiceError("Character not found", 404);
  }

  const novel = await NovelModel.findById(character.novel).select("user").lean();
  if (!novel || String(novel.user) !== String(userId)) {
    throw new CharacterServiceError(
      "Not authorized to delete this character",
      403
    );
  }

  await CharacterModel.deleteOne({ _id: characterId });

  logActivity({
    req,
    userId,
    action: "delete",
    module: "novel",
    description: "Character dossier deleted",
    metadata: {
      novelId: String(character.novel),
      characterId: String(characterId),
    },
  });

  if (memoryEnabled()) {
    onDelete({
      novelId: String(character.novel),
      characterId: String(characterId),
    });
  }

  return {
    characterId: String(characterId),
    novelId: String(character.novel),
  };
};

export { namesMatch };
