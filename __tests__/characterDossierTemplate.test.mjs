import test from "node:test";
import assert from "node:assert/strict";
import {
  buildManualCharacterDossierTemplate,
  normalizeManualCharacterType,
} from "../utils/characterDossierTemplate.js";

test("normalizeManualCharacterType maps aliases to canonical types", () => {
  assert.equal(normalizeManualCharacterType("Protagonist"), "protagonist");
  assert.equal(normalizeManualCharacterType("antagonist"), "antagonist");
  assert.equal(normalizeManualCharacterType("supporting"), "supporting character");
  assert.equal(normalizeManualCharacterType(""), "supporting character");
  assert.equal(normalizeManualCharacterType("sidekick"), "supporting character");
});

test("buildManualCharacterDossierTemplate includes header, 17 sections, and summary footer", () => {
  const text = buildManualCharacterDossierTemplate({
    name: "Lola Reyes",
    roleInStory: "sole narrator",
    characterType: "protagonist",
  });

  assert.match(text, /\*\*👤 Lola Reyes: 17-Point Dossier\*\*/);
  assert.match(text, /Role in the Story: Protagonist — sole narrator/);
  assert.match(text, /• Name: Lola Reyes/);
  assert.match(text, /📖 Summary Note of Character/);

  for (let n = 1; n <= 17; n++) {
    assert.match(text, new RegExp(`(^|\\n)${n}\\.\\s`));
  }
});

test("buildManualCharacterDossierTemplate seeds supporting type when role omitted", () => {
  const text = buildManualCharacterDossierTemplate({ name: "Camila" });
  assert.match(text, /Role in the Story: Supporting character/);
});
