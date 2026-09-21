/**
 * One-shot converter — methodology .md source → JSON seed.
 *
 * Reads the three structured markdown sources under
 * `seed/olivia-methodology/source/` and emits:
 *   - seed/olivia-methodology/methodology-rules.json   (15 rows)
 *   - seed/olivia-methodology/prompt-templates.json    (15 rows)
 *   - seed/olivia-methodology/genre-overlays.json      (24 rows)
 *
 * The .md format is intentionally limited and parseable: each row is
 * introduced by a `## row_id` heading, followed by a list of
 *   `- field: \`value\``  bullets (one per scalar field) and one or
 * more  `**fieldName:**` paragraph blocks (multi-line text). Arrays
 * appear either as backticked JSON-ish literals (e.g.
 *   `- aliases: ["a", "b"]`) or as bulleted lists under a `**beats:**`
 * section where each bullet is a backticked `{ ... }` object literal.
 *
 * Run:
 *   node storygroove-be/scripts/convertMethodologySourceToJson.js
 *
 * Idempotent. Safe to re-run after editing the markdown source.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const SRC_DIR = path.join(ROOT, "seed/olivia-methodology/source");
const OUT_DIR = path.join(ROOT, "seed/olivia-methodology");

// --- generic .md row parser -------------------------------------------------

/**
 * Split a markdown body on `## heading` boundaries (level-2). Returns
 * an array of `{ id, body }` blocks (the `#` and `> ` preamble before
 * the first `## ` heading is dropped — that's the schema description,
 * not data).
 */
const splitRowBlocks = (md) => {
  const lines = md.split("\n");
  const blocks = [];
  let current = null;
  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    if (h2) {
      if (current) blocks.push(current);
      current = { id: h2[1].trim(), body: "" };
      continue;
    }
    if (current) current.body += line + "\n";
  }
  if (current) blocks.push(current);
  // Drop blocks that are clearly trailing notes (no `- key:` line).
  return blocks.filter((b) => /^-\s+\w+\s*:/m.test(b.body));
};

/**
 * From a row body, pull out every `- field: value` bullet on a single
 * line. The value may be a backticked literal, a plain string, or
 * a bracketed JSON-ish array. Returns a Map keyed by field name.
 */
const parseScalarFields = (body) => {
  const fields = new Map();
  const lines = body.split("\n");
  for (const raw of lines) {
    const m = raw.match(/^-\s+([a-zA-Z_][\w]*)\s*:\s*(.+?)\s*$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    // Strip outer backticks.
    if (val.startsWith("`") && val.endsWith("`")) {
      val = val.slice(1, -1);
    }
    fields.set(key, val);
  }
  return fields;
};

/**
 * Extract `**fieldName:**` paragraph blocks. Each block runs until the
 * next `**fieldName:**`, `---`, or end of body. Returns a Map keyed
 * by lowercased field name.
 */
const parseParagraphBlocks = (body) => {
  const blocks = new Map();
  const lines = body.split("\n");
  let active = null;
  let buf = [];
  const flush = () => {
    if (!active) return;
    blocks.set(active.toLowerCase(), buf.join("\n").trim());
    active = null;
    buf = [];
  };
  for (const line of lines) {
    const h = line.match(/^\*\*([a-zA-Z][\w ]*?):\*\*\s*$/);
    if (h) {
      flush();
      active = h[1].trim();
      continue;
    }
    if (/^---\s*$/.test(line)) {
      flush();
      continue;
    }
    if (active !== null) buf.push(line);
  }
  flush();
  return blocks;
};

/**
 * Parse a value that may be `"true"`, `"false"`, `"null"`, a number, a
 * JSON-array literal, or a plain string. Used for the scalar fields
 * pulled out of `parseScalarFields`.
 */
const coerceValue = (val) => {
  if (val === undefined || val === null) return val;
  if (val === "true") return true;
  if (val === "false") return false;
  if (val === "null") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(val)) return Number(val);
  if (val.startsWith("[") && val.endsWith("]")) {
    try {
      return JSON.parse(val);
    } catch {
      // Fall through; some lists use single quotes — best-effort fix.
      try {
        return JSON.parse(val.replace(/'/g, '"'));
      } catch {
        return val;
      }
    }
  }
  return val;
};

// --- per-collection parsers -------------------------------------------------

const parseMethodologyRules = (md) => {
  const rows = [];
  for (const block of splitRowBlocks(md)) {
    const scalars = parseScalarFields(block.body);
    const paragraphs = parseParagraphBlocks(block.body);
    let phase = coerceValue(scalars.get("phase"));
    // Phase may arrive as `[outlining]` (single) or `[phase1_table, phase2_expansion]`.
    if (typeof phase === "string" && phase.startsWith("[") && phase.endsWith("]")) {
      phase = phase
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    rows.push({
      key: scalars.get("key"),
      title: scalars.get("title"),
      scope: scalars.get("scope"),
      phase: phase === "null" ? null : phase,
      priority: coerceValue(scalars.get("priority")) ?? 50,
      source: scalars.get("source"),
      enabled: coerceValue(scalars.get("enabled")) ?? true,
      summary: scalars.get("summary") || "",
      text: paragraphs.get("text") || "",
    });
  }
  return rows;
};

const parsePromptTemplates = (md) => {
  // Stop at the trailing `## Open question for JSON authoring` block.
  const cleaned = md.replace(/##\s+Open question for JSON authoring[\s\S]*$/m, "");
  const rows = [];
  for (const block of splitRowBlocks(cleaned)) {
    const scalars = parseScalarFields(block.body);
    const paragraphs = parseParagraphBlocks(block.body);
    let labels = scalars.get("outputFormatLabels");
    // The fixture says "same as scene_1" on rows 2..15 to avoid repetition;
    // resolve that here against scene_1's literal list.
    if (labels && labels.startsWith("same as scene_1")) labels = null;
    if (labels && labels.startsWith("[") && labels.endsWith("]")) {
      labels = labels
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^\(if applicable\)$/, "(if applicable)"));
    }
    rows.push({
      key: scalars.get("key"),
      sceneIndex: coerceValue(scalars.get("sceneIndex")),
      actNumber: coerceValue(scalars.get("actNumber")),
      title: scalars.get("title"),
      tentpoleHint: scalars.get("tentpoleHint") === "null" ? null : scalars.get("tentpoleHint"),
      source: scalars.get("source"),
      enabled: coerceValue(scalars.get("enabled")) ?? true,
      outputFormatLabels: labels,
      template: paragraphs.get("template") || "",
      coachingPrompt: paragraphs.get("coachingprompt") || "",
      subplotReminder: (() => {
        const v = paragraphs.get("subplotreminder") || "";
        // The fixture uses parenthetical asides ("(none in the blueprint
        // for scene 3 — leave empty string)") to flag intentionally
        // empty entries. Honor them.
        if (/^\(none/i.test(v)) return "";
        return v;
      })(),
    });
  }
  // Backfill scene_1's outputFormatLabels into rows where the markdown
  // said "same as scene_1".
  const baseLabels = rows[0]?.outputFormatLabels;
  for (const row of rows) {
    if (row.outputFormatLabels === null) row.outputFormatLabels = baseLabels;
  }
  return rows;
};

/**
 * Parse a single beat bullet of the form:
 *   `{ sceneIndex: 9, label: "Midpoint", beat: "..." }`
 *   `{ sceneRange: { from: 4, to: 5 }, beat: "..." }`
 *
 * We re-emit it through `Function` after wrapping field names in
 * quotes — safer than `eval` and good enough for trusted seed input.
 */
const parseBeatLiteral = (literal) => {
  const cleaned = literal
    .trim()
    .replace(/^`/, "")
    .replace(/`$/, "")
    .trim();
  // Quote bare keys → JSON.
  const quoted = cleaned.replace(/([{,]\s*)([a-zA-Z_]\w*)\s*:/g, '$1"$2":');
  return JSON.parse(quoted);
};

const parseGenreOverlays = (md) => {
  const rows = [];
  for (const block of splitRowBlocks(md)) {
    const scalars = parseScalarFields(block.body);
    const paragraphs = parseParagraphBlocks(block.body);
    // aliases is a JSON array literal on the scalar line.
    let aliases = scalars.get("aliases");
    if (typeof aliases === "string") {
      try {
        aliases = JSON.parse(aliases);
      } catch {
        aliases = aliases
          .replace(/^\[/, "")
          .replace(/\]$/, "")
          .split(",")
          .map((s) => s.trim().replace(/^"/, "").replace(/"$/, ""))
          .filter(Boolean);
      }
    }
    // beats come as bulleted backticked literals under **beats:**
    const beatsText = paragraphs.get("beats") || "";
    const beats = [];
    for (const line of beatsText.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("- `")) continue;
      const inner = trimmed.replace(/^-\s*`/, "").replace(/`$/, "").trim();
      try {
        beats.push(parseBeatLiteral(inner));
      } catch (err) {
        console.error("Failed to parse beat:", inner, err.message);
      }
    }
    rows.push({
      genreKey: scalars.get("genreKey"),
      displayName: scalars.get("displayName"),
      category: scalars.get("category"),
      appliesAs: scalars.get("appliesAs"),
      aliases: aliases || [],
      source: scalars.get("source"),
      enabled: coerceValue(scalars.get("enabled")) ?? true,
      applicabilityNote: paragraphs.get("applicabilitynote") || "",
      beats,
      notes: paragraphs.get("notes") || "",
    });
  }
  return rows;
};

// --- main -------------------------------------------------------------------

const run = () => {
  const rulesSrc = fs.readFileSync(path.join(SRC_DIR, "methodology-rules.md"), "utf8");
  const templatesSrc = fs.readFileSync(path.join(SRC_DIR, "prompt-templates.md"), "utf8");
  const overlaysSrc = fs.readFileSync(path.join(SRC_DIR, "genre-overlays.md"), "utf8");

  const rules = parseMethodologyRules(rulesSrc);
  const templates = parsePromptTemplates(templatesSrc);
  const overlays = parseGenreOverlays(overlaysSrc);

  fs.writeFileSync(
    path.join(OUT_DIR, "methodology-rules.json"),
    JSON.stringify(rules, null, 2) + "\n"
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "prompt-templates.json"),
    JSON.stringify(templates, null, 2) + "\n"
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "genre-overlays.json"),
    JSON.stringify(overlays, null, 2) + "\n"
  );

  console.log(
    `Wrote ${rules.length} rules, ${templates.length} templates, ${overlays.length} overlays`
  );
};

run();
