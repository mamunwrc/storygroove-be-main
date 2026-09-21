import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeImportBundle,
  validatePromptRow,
  preparePromptDoc,
  equalIgnoringMeta,
  stripRowForExport,
} from "../utils/agentPromptBundle.js";

test("normalizeImportBundle accepts canonical, GET shape, and raw array", () => {
  const row = { agentName: "simone", prompt: "hello" };
  assert.deepEqual(normalizeImportBundle({ prompts: [row] }), { prompts: [row] });
  assert.deepEqual(normalizeImportBundle({ agentPrompts: [row] }), { prompts: [row] });
  assert.deepEqual(normalizeImportBundle([row]), { prompts: [row] });
});

test("validatePromptRow requires agentName and prompt", () => {
  assert.equal(validatePromptRow({}, 0).length > 0, true);
  assert.equal(
    validatePromptRow({ agentName: "simone", prompt: "x" }, 0).length,
    0
  );
});

test("preparePromptDoc normalizes agentName and line endings", () => {
  const doc = preparePromptDoc({
    agentName: " Simone ",
    prompt: "line1\r\nline2",
    description: null,
  });
  assert.equal(doc.agentName, "simone");
  assert.equal(doc.prompt, "line1\nline2");
  assert.equal(doc.description, "");
});

test("equalIgnoringMeta compares prompt and description", () => {
  assert.equal(
    equalIgnoringMeta(
      { prompt: "a\r\nb", description: "d" },
      { prompt: "a\nb", description: "d" }
    ),
    true
  );
  assert.equal(
    equalIgnoringMeta({ prompt: "a", description: "" }, { prompt: "b", description: "" }),
    false
  );
});

test("stripRowForExport omits mongo meta fields", () => {
  const row = stripRowForExport({
    _id: "abc",
    agentName: "Olivia",
    prompt: "p",
    description: "d",
    createdAt: new Date(),
  });
  assert.deepEqual(row, {
    agentName: "olivia",
    prompt: "p",
    description: "d",
  });
});
