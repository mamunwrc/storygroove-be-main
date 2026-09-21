/**
 * Outline export — summary table and per-scene Scene Design blocks as a .docx file.
 */
import {
  Document,
  Packer,
  Paragraph,
  SectionType,
  VerticalAlignSection,
} from "docx";
import { letterPage } from "../utils/docxPageSetup.js";
import Novel from "../models/novelModel.js";
import UserContent from "../models/userContentModel.js";
import StoryResponse from "../models/storyResponseModel.js";
import OliviaSceneSuggestion from "../models/oliviaSceneSuggestionModel.js";
import { stripMarkdownForDocx } from "../utils/stripMarkdown.js";
import { buildSafeDocxFilenameFromTitle } from "../utils/downloadFilename.js";
import {
  buildOutlineSceneRows,
  formatOutlineSceneRowsAsMarkdownTable,
} from "../utils/buildOutlineSceneRows.js";
import {
  outlineMarkdownToDocxParagraphs,
  outlineSceneBlockToDocxParagraphs,
  outlineSectionTitleParagraph,
  outlineCenteredTitleParagraph,
  outlineSpacerParagraph,
  parseInlineRuns,
} from "../utils/outlineTextToDocx.js";

const ACT_WORDS = [
  "ONE",
  "TWO",
  "THREE",
  "FOUR",
  "FIVE",
  "SIX",
  "SEVEN",
  "EIGHT",
  "NINE",
  "TEN",
];

const actLabel = (n) => `ACT ${ACT_WORDS[n - 1] || n}`;

export class OutlineExportError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "OutlineExportError";
    this.statusCode = statusCode;
  }
}

/** Synthesize rich scene design text from legacy OliviaSceneSuggestion rows. */
export const synthesizeSceneDesignFromSuggestion = (suggestion) => {
  if (!suggestion) return "";
  const lines = [];
  const title =
    suggestion.structural_role?.trim() ||
    suggestion.what_happens?.trim()?.slice(0, 80) ||
    "";
  if (title) lines.push(`Scene Title: ${title}`);

  const coaching =
    suggestion.book_coaching?.trim() ||
    suggestion.craft_or_coaching_note?.trim() ||
    "";
  if (coaching) lines.push(`📘 Book Coaching for Scene: ${coaching}`);

  if (suggestion.genre_specific_coaching?.trim()) {
    lines.push(
      `🎭 Genre-Specific Coaching Note: ${suggestion.genre_specific_coaching.trim()}`
    );
  }
  if (suggestion.subplot_reminder?.trim()) {
    lines.push(`🧩 Subplot Reminder: ${suggestion.subplot_reminder.trim()}`);
  }
  if (suggestion.target_word_count != null) {
    lines.push(
      `📏 Target Word Count: ${suggestion.target_word_count} words`
    );
  }
  if (suggestion.what_happens?.trim()) {
    lines.push(`📝 Scene to Write: ${suggestion.what_happens.trim()}`);
  }
  if (suggestion.setting?.trim()) {
    lines.push(`🏰 Setting: ${suggestion.setting.trim()}`);
  }
  if (suggestion.significant_actions?.trim()) {
    const actions = suggestion.significant_actions.trim();
    const bulletBody = actions.includes("\n")
      ? actions
      : `- ${actions}`;
    lines.push(`⚡ Significant Actions (Scene Beats):\n${bulletBody}`);
  }
  if (suggestion.emotional_reactions?.trim()) {
    const reactions = suggestion.emotional_reactions.trim();
    const bulletBody = reactions.includes("\n")
      ? reactions
      : `- ${reactions}`;
    lines.push(
      `💔 Emotional Reactions (Character Interiority):\n${bulletBody}`
    );
  } else if (suggestion.protagonist_emotional_shift?.trim()) {
    lines.push(
      `💔 Emotional Reactions (Character Interiority):\n- ${suggestion.protagonist_emotional_shift.trim()}`
    );
  }
  if (suggestion.subplot_integration?.trim()) {
    lines.push(`🔗 Subplot Tie-In: ${suggestion.subplot_integration.trim()}`);
  }
  if (suggestion.character_arc_movement?.trim()) {
    lines.push(
      `📈 Character Arc Movement: ${suggestion.character_arc_movement.trim()}`
    );
  }
  return lines.join("\n\n");
};

export const hasOutlineExportContent = ({
  sceneRows = [],
  suggestions = [],
}) => {
  if (sceneRows.some((r) => r.responseText?.trim())) return true;
  if (suggestions.length > 0) return true;
  return false;
};

export const buildSafeOutlineFilename = (novelName) =>
  buildSafeDocxFilenameFromTitle(novelName, "Outline", "Novel");

/**
 * @param {{ novelId: string, userId: string, user?: object }} params
 * @returns {Promise<{ buffer: Buffer, filename: string }>}
 */
export const generateOutlineDocx = async ({ novelId, userId, user }) => {
  const novel = await Novel.findOne({ _id: novelId, user: userId }).lean();
  if (!novel) {
    throw new OutlineExportError("Novel not found", 404);
  }

  const [userContents, sceneDocs, suggestions] = await Promise.all([
    UserContent.find({ novelId, user: userId })
      .sort({ actNumber: 1, sceneIndex: 1 })
      .lean(),
    StoryResponse.find({ novel: novelId, user: userId }).lean(),
    OliviaSceneSuggestion.find({ novel: novelId, user: userId })
      .sort({ scene_index: 1 })
      .lean(),
  ]);

  const sceneRows = buildOutlineSceneRows(sceneDocs, userContents);
  const suggestionByIndex = new Map(
    suggestions.map((s) => [Number(s.scene_index), s])
  );

  for (const row of sceneRows) {
    if (row.responseText?.trim()) continue;
    const legacy = suggestionByIndex.get(row.globalNum);
    if (legacy) {
      row.responseText = synthesizeSceneDesignFromSuggestion(legacy);
    }
  }

  if (!hasOutlineExportContent({ sceneRows, suggestions })) {
    throw new OutlineExportError("No scene design content found for this novel", 404);
  }

  const page = letterPage();

  const novelTitle =
    stripMarkdownForDocx(String(novel.name || "")) || "Untitled Novel";
  const storyBibleByline =
    typeof novel.storyBibleAuthor === "string"
      ? stripMarkdownForDocx(novel.storyBibleAuthor.trim())
      : "";
  const authorName =
    storyBibleByline ||
    [user?.fname, user?.lname].filter(Boolean).join(" ").trim() ||
    user?.username ||
    "";

  const titlePageChildren = [
    outlineCenteredTitleParagraph(novelTitle, { bold: true, size: 64 }),
    outlineCenteredTitleParagraph(""),
    outlineCenteredTitleParagraph("Novel Outline", { size: 32 }),
    outlineCenteredTitleParagraph(""),
    outlineCenteredTitleParagraph("by", { italics: true, size: 28 }),
    outlineCenteredTitleParagraph(authorName || "", { size: 32 }),
  ];

  if (novel.genre) {
    const genreDisplay = stripMarkdownForDocx(String(novel.genre));
    if (genreDisplay) {
      titlePageChildren.push(outlineCenteredTitleParagraph(""));
      titlePageChildren.push(
        outlineCenteredTitleParagraph(genreDisplay, { italics: true, size: 24 })
      );
    }
  }

  const bodyChildren = [];

  const exportableRows = sceneRows.filter((r) => r.responseText?.trim());
  if (exportableRows.length > 0) {
    bodyChildren.push(outlineSectionTitleParagraph("Outline Summary", 1));
    const tableMd = formatOutlineSceneRowsAsMarkdownTable(exportableRows);
    bodyChildren.push(...outlineMarkdownToDocxParagraphs(tableMd));
    bodyChildren.push(outlineSpacerParagraph(240));
  }

  const actsPresent = [...new Set(sceneRows.map((r) => r.actNumber))].sort(
    (a, b) => a - b
  );
  const actOrder = [1, 2, 3].filter((a) => actsPresent.includes(a));
  const otherActs = actsPresent.filter((a) => !actOrder.includes(a));
  const orderedActs = [...actOrder, ...otherActs];

  for (const act of orderedActs) {
    const actScenes = sceneRows.filter(
      (r) => r.actNumber === act && r.responseText?.trim()
    );
    if (!actScenes.length) continue;

    const actInfo = novel.acts?.find((a) => a.actNumber === act);
    const actHeading = actInfo?.title
      ? `${actLabel(act)}: ${stripMarkdownForDocx(actInfo.title)}`
      : actLabel(act);

    bodyChildren.push(outlineSectionTitleParagraph(actHeading, 1));

    for (const scene of actScenes) {
      bodyChildren.push(
        ...outlineSceneBlockToDocxParagraphs(scene.responseText, {
          globalNum: scene.globalNum,
          title: stripMarkdownForDocx(scene.title),
        })
      );
    }
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page,
          verticalAlign: VerticalAlignSection.CENTER,
        },
        children: titlePageChildren,
      },
      {
        properties: {
          type: SectionType.NEXT_PAGE,
          page,
        },
        children: bodyChildren.length
          ? bodyChildren
          : [
              new Paragraph({
                children: parseInlineRuns("No outline scenes available."),
              }),
            ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return {
    buffer,
    filename: buildSafeOutlineFilename(novel.name),
  };
};
