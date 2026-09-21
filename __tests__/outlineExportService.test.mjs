import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { Document, Packer, convertInchesToTwip } from "docx";
import {
  buildOutlineSceneRows,
  formatOutlineSceneRowsAsMarkdownTable,
} from "../utils/buildOutlineSceneRows.js";
import {
  outlineMarkdownToDocxParagraphs,
  outlineSceneBlockToDocxParagraphs,
  outlineSectionTitleParagraph,
  outlineSpacerParagraph,
  normalizeSceneDesignTextForExport,
  parseInlineRuns,
} from "../utils/outlineTextToDocx.js";
import {
  synthesizeSceneDesignFromSuggestion,
  hasOutlineExportContent,
  buildSafeOutlineFilename,
} from "../service/outlineExportService.js";

const RICH_SCENE_FIXTURE = `Scene Title: Rooftop Reckoning
POV: Lola Reyes
[TENTPOLE]
📘 Book Coaching for Scene: Anchor the inciting rupture with public stakes.
🎭 Genre-Specific Coaching Note (Contemporary): Social-media fallout must feel irreversible.
🧩 Subplot Reminder: Seed the friendship fracture.
📏 Target Word Count: 6000 words
📝 Scene to Write: Lola confronts the viral clip at a rooftop party.
🏰 Setting: Miami skyline, bass thumping, champagne and neon.
⚡ Significant Actions (Scene Beats):
- Lola sees the clip replay on a tower screen
- She storms the DJ booth
- Marcus blocks her path with a contract folder
💔 Emotional Reactions (Character Interiority):
- Lola feels exposed and furious
- She masks panic with performative bravado
🔗 Subplot Tie-In: The brand deal subplot tightens.
📈 Character Arc Movement: Lola shifts from denial to controlled damage control.`;

test("buildOutlineSceneRows prefers userContent sceneTitle over storyResponse extraction", () => {
  const rows = buildOutlineSceneRows(
    [{ promptKey: "scene1", responseText: RICH_SCENE_FIXTURE }],
    [
      {
        promptKey: "scene1",
        actNumber: 1,
        sceneIndex: 1,
        sceneTitle: "Sidebar Rename",
      },
    ]
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].globalNum, 1);
  assert.equal(rows[0].title, "Sidebar Rename");
  assert.equal(rows[0].pov, "Lola Reyes");
  assert.ok(rows[0].summary.includes("rooftop party"));
  assert.ok(rows[0].purpose.includes("inciting"));
});

test("buildOutlineSceneRows extracts title from storyResponse when sceneTitle empty", () => {
  const rows = buildOutlineSceneRows(
    [{ promptKey: "scene1", responseText: RICH_SCENE_FIXTURE }],
    [{ promptKey: "scene1", actNumber: 1, sceneIndex: 1 }]
  );
  assert.equal(rows[0].title, "Rooftop Reckoning");
});

test("formatOutlineSceneRowsAsMarkdownTable includes header and scene row", () => {
  const rows = buildOutlineSceneRows(
    [{ promptKey: "scene1", responseText: RICH_SCENE_FIXTURE }],
    [{ promptKey: "scene1", actNumber: 1, sceneIndex: 1 }]
  );
  const table = formatOutlineSceneRowsAsMarkdownTable(rows);
  assert.match(table, /^\| Chapter # \| Act \| Title \| POV \| Chapter Purpose \| Summary \|/);
  assert.match(table, /Chapter 1 \| 1 \| Rooftop Reckoning/);
});

test("outlineSceneBlockToDocxParagraphs preserves rich scene sections", () => {
  const paras = outlineSceneBlockToDocxParagraphs(RICH_SCENE_FIXTURE, {
    globalNum: 1,
    title: "Rooftop Reckoning",
  });
  assert.ok(paras.length >= 5);
});

test("normalizeSceneDesignTextForExport strips redundant header meta from body", () => {
  const raw =
    "Scene Title: Birthday Glass POV: Lola Reyes\n[TENTPOLE]\n📏 Target Word Count: 6000 words\n📘 Book Coaching for Scene: Open with velocity.";
  const normalized = normalizeSceneDesignTextForExport(raw);
  assert.doesNotMatch(normalized, /Scene Title/i);
  assert.doesNotMatch(normalized, /^POV\s*:/im);
  assert.doesNotMatch(normalized, /Target Word Count/i);
  assert.doesNotMatch(normalized, /\[TENTPOLE\]/i);
  assert.match(normalized, /Book Coaching for Scene/);
});

test("outlineSceneBlockToDocxParagraphs includes POV under scene heading", async () => {
  const sceneText = `Scene Title: Birthday Glass
POV: Lola Reyes
📘 Book Coaching for Scene: Open with velocity.`;

  const paras = outlineSceneBlockToDocxParagraphs(sceneText, {
    globalNum: 1,
    title: "Birthday Glass",
  });
  const doc = new Document({
    sections: [{ children: paras }],
  });
  const buffer = await Packer.toBuffer(doc);
  const dir = mkdtempSync(join(tmpdir(), "outline-pov-"));
  writeFileSync(join(dir, "t.docx"), buffer);
  execSync(`unzip -q -o "${join(dir, "t.docx")}" -d "${dir}"`);
  const xml = readFileSync(join(dir, "word/document.xml"), "utf8");
  rmSync(dir, { recursive: true, force: true });

  assert.match(xml, /POV:/);
  assert.match(xml, /Lola Reyes/);
});

test("scene design sections render label and body as separate paragraphs", () => {
  const text = normalizeSceneDesignTextForExport(`Scene Title: Birthday Glass
POV: Lola Reyes
📘 Book Coaching for Scene: Open with velocity and social texture, but keep Lola emotionally legible.
🎭 Genre-Specific Coaching Note (Contemporary): Social-media fallout must feel irreversible.`);

  const paras = outlineMarkdownToDocxParagraphs(text);
  assert.ok(paras.length >= 4);
});

test("outlineMarkdownToDocxParagraphs handles bullets and emoji headers", () => {
  const paras = outlineMarkdownToDocxParagraphs(
    "📘 Book Coaching for Scene: Test coaching\n- First beat\n- Second beat"
  );
  assert.ok(paras.length >= 3);
});

test("parseInlineRuns splits bold markers", () => {
  const runs = parseInlineRuns("Hello **world**");
  assert.equal(runs.length, 2);
});

test("synthesizeSceneDesignFromSuggestion builds Olivia-format block", () => {
  const text = synthesizeSceneDesignFromSuggestion({
    scene_index: 1,
    structural_role: "Opening Image",
    book_coaching: "Open with contrast.",
    what_happens: "Hero wakes to chaos.",
    setting: "Apartment at dawn.",
    significant_actions: "Alarm fails\nPhone explodes with notifications",
    protagonist_emotional_shift: "Dread",
    plot_advancement: "Hook",
    craft_or_coaching_note: "Keep it vivid.",
  });
  assert.match(text, /Scene Title: Opening Image/);
  assert.match(text, /📘 Book Coaching for Scene:/);
  assert.match(text, /📝 Scene to Write:/);
});

test("hasOutlineExportContent detects story responses and legacy suggestions", () => {
  assert.equal(
    hasOutlineExportContent({
      sceneRows: [{ responseText: "📘 Book Coaching for Scene: x" }],
      suggestions: [],
    }),
    true
  );
  assert.equal(
    hasOutlineExportContent({
      sceneRows: [{ title: "Custom Scene", responseText: "" }],
      suggestions: [],
    }),
    false
  );
  assert.equal(
    hasOutlineExportContent({ sceneRows: [], suggestions: [{ scene_index: 1 }] }),
    true
  );
  assert.equal(
    hasOutlineExportContent({
      sceneRows: [{ title: "Scene 1", responseText: "" }],
      suggestions: [],
    }),
    false
  );
});

test("buildSafeOutlineFilename sanitizes novel title", () => {
  assert.equal(
    buildSafeOutlineFilename('Party Girls 40! - May 22nd'),
    "Party Girls 40! - May 22nd_Outline.docx"
  );
  assert.equal(
    buildSafeOutlineFilename(
      "Triptych of Totems — La Dueda / The Miner's Ocarina"
    ),
    "Triptych of Totems - La Dueda - The Miner's Ocarina_Outline.docx"
  );
  assert.equal(buildSafeOutlineFilename(""), "Novel_Outline.docx");
});

test("outline docx document.xml has no invalid array-index tags", async () => {
  const rows = buildOutlineSceneRows(
    [{ promptKey: "scene1", responseText: RICH_SCENE_FIXTURE }],
    [{ promptKey: "scene1", actNumber: 1, sceneIndex: 1 }]
  );
  const tableMd = formatOutlineSceneRowsAsMarkdownTable(rows);
  const marginTwip = convertInchesToTwip(1);
  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: marginTwip,
              right: marginTwip,
              bottom: marginTwip,
              left: marginTwip,
            },
          },
        },
        children: [
          outlineSectionTitleParagraph("Outline Summary", 1),
          ...outlineMarkdownToDocxParagraphs(tableMd),
          outlineSpacerParagraph(240),
          ...outlineSceneBlockToDocxParagraphs(RICH_SCENE_FIXTURE, {
            globalNum: 1,
            title: "Rooftop Reckoning",
          }),
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  const dir = mkdtempSync(join(tmpdir(), "outline-docx-"));
  const docxPath = join(dir, "test.docx");
  writeFileSync(docxPath, buffer);
  execSync(`unzip -q -o "${docxPath}" -d "${dir}"`);
  const xml = readFileSync(join(dir, "word/document.xml"), "utf8");
  rmSync(dir, { recursive: true, force: true });

  assert.doesNotMatch(xml, /<0\/>|<\d+\/>/);
  assert.match(xml, /<w:document/);
});
