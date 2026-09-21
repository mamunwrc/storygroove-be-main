import test from "node:test";
import assert from "node:assert/strict";
import { parseCharacterDossiersFromText, extractCharacterNameFromDossier, isOliviaDuplicatedDossier, stripDossierTrailingBridge, DOSSIER_NAME_SCAN_CHARS } from "../utils/extractNovelData.js";

const dossier = (name, roleLine) =>
  [
    `**👤 ${name}: 17-Point Dossier**`,
    "1. 🧬 Archetype and Role",
    `• **Role in the Story:** **${roleLine}**`,
    "2. 📋 Basic Information",
    `• Name: ${name}`,
  ].join("\n");

test("parseCharacterDossiersFromText classifies multiple protagonists independently", () => {
  const text = [
    dossier("Lola Reyes", "Protagonist and sole narrator"),
    "",
    dossier("Elena Cruz", "Protagonist — co-lead"),
    "",
    dossier("Marcus Reyes", "Antagonist — husband"),
    "",
    dossier("Camila Virelli", "Supporting character — best friend"),
  ].join("\n");

  const parsed = parseCharacterDossiersFromText(text);
  assert.equal(parsed.length, 4);
  assert.equal(parsed[0].characterType, "protagonist");
  assert.equal(parsed[1].characterType, "protagonist");
  assert.equal(parsed[2].characterType, "antagonist");
  assert.equal(parsed[3].characterType, "supporting character");
});

test("parseCharacterDossiersFromText allows multiple antagonists", () => {
  const text = [
    dossier("The Colonel", "Antagonist — military rival"),
    "",
    dossier("Isabel", "Antagonist — social rival"),
  ].join("\n");

  const parsed = parseCharacterDossiersFromText(text);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].characterType, "antagonist");
  assert.equal(parsed[1].characterType, "antagonist");
});

test("extractCharacterNameFromDossier reads markdown and plain headings", () => {
  assert.equal(
    extractCharacterNameFromDossier("**👤 Lola Reyes: 17-Point Dossier**\n• Name: Lola Reyes"),
    "Lola Reyes"
  );
  assert.equal(
    extractCharacterNameFromDossier("👤 Elena Cruz: 17-Point Dossier\n   • Name: Lola Reyes"),
    "Elena Cruz"
  );
  assert.equal(
    extractCharacterNameFromDossier("2. Basic Information\n   • Name: Marcus Reyes"),
    "Marcus Reyes"
  );
  assert.equal(
    extractCharacterNameFromDossier("👤 Pat Hale: 17-Point Dossier\n" + "x".repeat(200_000)),
    "Pat Hale"
  );
  assert.equal(
    extractCharacterNameFromDossier("x".repeat(DOSSIER_NAME_SCAN_CHARS) + "\n• Name: Should Ignore"),
    ""
  );
});

test("isOliviaDuplicatedDossier ignores a template plus extra Archetype heading", () => {
  const pasted = [
    "**👤 Lola Reyes: 17-Point Dossier**",
    "1. 🧬 Archetype and Role",
    "• **Role in the Story:** Protagonist",
    "2. 📋 Basic Information",
    "• Name: Lola Reyes",
    "📖 Summary Note of Character",
    "A long imported bio from another tool.",
    "1. Archetype notes copied from Sudowrite",
    "She has pages of backstory after this heading.",
  ].join("\n");
  assert.equal(isOliviaDuplicatedDossier(pasted), false);
});

test("isOliviaDuplicatedDossier detects a full Olivia double-emit", () => {
  const duplicated = [
    "**👤 Lola Reyes: 17-Point Dossier**",
    "1. 🧬 Archetype and Role",
    "📖 Summary Note of Character",
    "First copy.",
    "1. 🧬 Archetype and Role",
    "📖 Summary Note of Character",
    "Second copy.",
  ].join("\n");
  assert.equal(isOliviaDuplicatedDossier(duplicated), true);
});

test("stripDossierTrailingBridge keeps imported body and only drops Olivia CTA", () => {
  const body = "Long character notes.\n\n1. Archetype extra\nMore pages.";
  const withCta = `${body}\n\n🎭 Here are your full 17-point character dossiers.`;
  assert.equal(stripDossierTrailingBridge(withCta), body);
  assert.equal(stripDossierTrailingBridge(body), body);
});
