import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import {
  createManualCharacter,
  deleteCharacter,
  CharacterServiceError,
  findDuplicateCharacterByName,
  safeUpsertDossierCharacter,
} from "../service/characterService.js";
import { buildManualCharacterDossierTemplate } from "../utils/characterDossierTemplate.js";

const novelId = new mongoose.Types.ObjectId().toString();
const userId = new mongoose.Types.ObjectId();

const makeDeps = ({ existing = [], created = [] } = {}) => {
  const store = [...existing];
  const Novel = {
    findOne: () => ({
      select: () => ({
        lean: async () => ({ _id: novelId }),
      }),
    }),
  };
  const Character = {
    find: () => ({
      select: () => ({
        lean: async () => store.map((c) => ({ name: c.name })),
      }),
    }),
    create: async (doc) => {
      const row = {
        ...doc,
        _id: new mongoose.Types.ObjectId(),
      };
      store.push(row);
      created.push(row);
      return row;
    },
    findOneAndUpdate: async (filter, update) => {
      const found = store.find(
        (c) =>
          String(c.name) === String(filter.name) &&
          c.character === filter.character
      );
      if (found) {
        Object.assign(found, update);
        return found;
      }
      const row = { _id: new mongoose.Types.ObjectId(), ...filter, ...update };
      store.push(row);
      return row;
    },
  };
  return {
    Novel,
    Character,
    store,
    created,
    queueActivityLog: () => {},
    isOliviaMemoryV2Enabled: () => false,
  };
};

test("findDuplicateCharacterByName is case-insensitive", () => {
  const hit = findDuplicateCharacterByName(
    [{ name: "Lola Reyes" }],
    "lola reyes"
  );
  assert.equal(hit.name, "Lola Reyes");
  assert.equal(findDuplicateCharacterByName([{ name: "Elena" }], "Lola"), null);
});

test("createManualCharacter seeds supporting type when role omitted", async () => {
  const created = [];
  const deps = makeDeps({ created });
  const { character } = await createManualCharacter(
    {
      novelId,
      userId,
      name: "Emon",
      characterType: "supporting character",
    },
    deps
  );

  assert.equal(character.role, "Supporting character");
});

test("createManualCharacter seeds a 17-point template and persists the character", async () => {
  const created = [];
  const deps = makeDeps({ created });
  const { character } = await createManualCharacter(
    {
      novelId,
      userId,
      name: "Camila Virelli",
      role: "best friend",
      characterType: "supporting character",
    },
    deps
  );

  assert.equal(character.name, "Camila Virelli");
  assert.equal(character.character, "supporting character");
  assert.match(character.responseText, /\*\*👤 Camila Virelli: 17-Point Dossier\*\*/);
  assert.match(character.responseText, /1\. 🧬 Archetype and Role/);
  assert.match(character.responseText, /📖 Summary Note of Character/);
  assert.equal(created.length, 1);
});

test("createManualCharacter allows a second protagonist with a different name", async () => {
  const created = [];
  const deps = makeDeps({
    existing: [{ name: "Lola Reyes", character: "protagonist" }],
    created,
  });

  const { character } = await createManualCharacter(
    {
      novelId,
      userId,
      name: "Elena Cruz",
      characterType: "protagonist",
    },
    deps
  );

  assert.equal(character.character, "protagonist");
  assert.equal(character.name, "Elena Cruz");
  assert.equal(created.length, 1);
});

test("createManualCharacter rejects a duplicate name with 409", async () => {
  const deps = makeDeps({
    existing: [{ name: "Lola Reyes", character: "protagonist" }],
  });

  await assert.rejects(
    () =>
      createManualCharacter(
        { novelId, userId, name: "lola reyes", characterType: "antagonist" },
        deps
      ),
    (err) =>
      err instanceof CharacterServiceError &&
      err.statusCode === 409 &&
      /already exists/i.test(err.message)
  );
});

test("createManualCharacter rejects a missing name", async () => {
  const deps = makeDeps();
  await assert.rejects(
    () => createManualCharacter({ novelId, userId, name: "   " }, deps),
    (err) => err instanceof CharacterServiceError && err.statusCode === 400
  );
});

test("deleteCharacter removes a character the writer owns", async () => {
  const characterId = new mongoose.Types.ObjectId();
  const store = [
    { _id: characterId, novel: novelId, name: "Experimental", character: "supporting character" },
  ];
  let deleted = null;
  const deps = {
    Novel: {
      findById: () => ({
        select: () => ({
          lean: async () => ({ _id: novelId, user: userId }),
        }),
      }),
    },
    Character: {
      findById: async (id) => store.find((c) => String(c._id) === String(id)) || null,
      deleteOne: async ({ _id }) => {
        deleted = String(_id);
        const idx = store.findIndex((c) => String(c._id) === String(_id));
        if (idx >= 0) store.splice(idx, 1);
        return { deletedCount: idx >= 0 ? 1 : 0 };
      },
    },
    queueActivityLog: () => {},
    isOliviaMemoryV2Enabled: () => false,
  };

  const result = await deleteCharacter(
    { characterId: characterId.toString(), userId },
    deps
  );

  assert.equal(result.characterId, characterId.toString());
  assert.equal(deleted, characterId.toString());
  assert.equal(store.length, 0);
});

test("deleteCharacter rejects a missing character with 404", async () => {
  const deps = {
    Novel: {
      findById: () => ({
        select: () => ({ lean: async () => ({ _id: novelId, user: userId }) }),
      }),
    },
    Character: {
      findById: async () => null,
      deleteOne: async () => {
        throw new Error("should not delete");
      },
    },
    queueActivityLog: () => {},
    isOliviaMemoryV2Enabled: () => false,
  };

  await assert.rejects(
    () =>
      deleteCharacter(
        { characterId: new mongoose.Types.ObjectId().toString(), userId },
        deps
      ),
    (err) => err instanceof CharacterServiceError && err.statusCode === 404
  );
});

test("safeUpsertDossierCharacter upserts by novel+name+type without demoting a second protagonist", async () => {
  const store = [
    {
      name: "Lola Reyes",
      character: "protagonist",
      responseText: "old",
    },
  ];
  const Character = {
    findOneAndUpdate: async (filter, update, opts) => {
      assert.equal(filter.character, "protagonist");
      assert.equal(filter.name, "Elena Cruz");
      assert.equal(opts.upsert, true);
      const row = { _id: "new", ...filter, ...update };
      store.push(row);
      return row;
    },
  };

  const saved = await safeUpsertDossierCharacter(
    novelId,
    {
      name: "Elena Cruz",
      characterType: "protagonist",
      roleInStory: "Protagonist — co-lead",
      dossierText: buildManualCharacterDossierTemplate({
        name: "Elena Cruz",
        characterType: "protagonist",
      }),
    },
    { Character }
  );

  assert.equal(saved.character, "protagonist");
  assert.equal(store.length, 2);
});
