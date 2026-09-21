/**
 * Characters export — per-character dossiers as a .docx file.
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
import Character from "../models/characterModel.js";
import { stripMarkdownForDocx } from "../utils/stripMarkdown.js";
import { buildSafeDocxFilenameFromTitle } from "../utils/downloadFilename.js";
import { extractCharacterDossierBlocksFromMasterPrompt } from "../utils/extractNovelData.js";
import { castTypeAccordionLabel } from "../utils/characterDossierTemplate.js";
import { sortCharactersByUserOrder } from "../utils/characterSortOrder.js";
import {
  outlineCenteredTitleParagraph,
  outlineMarkdownToDocxParagraphs,
  outlineSectionTitleParagraph,
  outlineSpacerParagraph,
  parseInlineRuns,
} from "../utils/outlineTextToDocx.js";

export class CharactersExportError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "CharactersExportError";
    this.statusCode = statusCode;
  }
}

const CHARACTER_SORT_ORDER = {
  protagonist: 0,
  antagonist: 1,
  "supporting character": 2,
};

const castNameFromNovelField = (value) => {
  if (!value || typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const firstLine = trimmed.split("\n")[0].trim();
  const beforeDash = firstLine.split(/\s+[—–-]\s+/)[0].trim();
  return beforeDash || firstLine;
};

const shortCharacterRoleForExport = (role) => {
  if (!role || typeof role !== "string") return "";
  const trimmed = role.trim();
  if (!trimmed) return "";
  const beforeSemicolon = trimmed.split(";")[0].trim();
  const label = beforeSemicolon
    .split(/\b(?:whose|who|that|which|and|with)\b/i)[0]
    .trim();
  return (
    label.replace(/[,\s]+$/, "") ||
    beforeSemicolon.split(/\s+/).slice(0, 2).join(" ")
  );
};

const buildFallbackCastFromNovel = (novel, novelId) => {
  const out = [];
  const idPrefix = `cast-${String(novelId)}`;

  const pName = castNameFromNovelField(novel.protagonist);
  if (pName) {
    out.push({
      _id: `${idPrefix}-protagonist`,
      name: pName,
      character: "protagonist",
      role: novel.protagonistDescription
        ? castNameFromNovelField(novel.protagonistDescription).slice(0, 120)
        : undefined,
      responseText: novel.protagonistDescription?.trim() || "",
    });
  }

  const aName = castNameFromNovelField(novel.antagonist);
  if (aName) {
    const motivation = novel.antagonistMotivation?.trim() || "";
    out.push({
      _id: `${idPrefix}-antagonist`,
      name: aName,
      character: "antagonist",
      role: motivation ? motivation.slice(0, 120) : undefined,
      responseText: motivation,
    });
  }

  const supporting = Array.isArray(novel.supportingCharacters)
    ? novel.supportingCharacters
    : [];
  supporting.forEach((sc, idx) => {
    const name = (sc?.name && String(sc.name).trim()) || "";
    if (!name) return;
    const bits = [sc.role, sc.significance].filter(Boolean).join(" — ");
    out.push({
      _id: `${idPrefix}-supporting-${idx}`,
      name,
      character: "supporting character",
      role: sc.role || undefined,
      responseText: bits || "",
    });
  });

  return out;
};

const sortCharactersForExport = (characters) => {
  const anyUserOrder = characters.some((c) => Number.isFinite(c?.sortOrder));
  if (anyUserOrder) return sortCharactersByUserOrder(characters);
  return [...characters].sort((a, b) => {
    const ao = CHARACTER_SORT_ORDER[a.character] ?? 3;
    const bo = CHARACTER_SORT_ORDER[b.character] ?? 3;
    if (ao !== bo) return ao - bo;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
};

const characterHeading = (character) => {
  const roleSource =
    String(character.role || "").trim() ||
    castTypeAccordionLabel(character.character);
  const role = shortCharacterRoleForExport(roleSource);
  if (role) return `${character.name} — ${role}`;
  return `Character Profile: ${character.name}`;
};

export const hasCharactersExportContent = (characters = []) =>
  characters.some((c) => String(c.responseText || "").trim());

export const buildSafeCharactersFilename = (novelName) =>
  buildSafeDocxFilenameFromTitle(novelName, "Characters", "Novel");

/**
 * @param {{ novelId: string, userId: string, user?: object }} params
 * @returns {Promise<{ buffer: Buffer, filename: string }>}
 */
export const generateCharactersDocx = async ({ novelId, userId, user }) => {
  const novel = await Novel.findOne({ _id: novelId, user: userId }).lean();
  if (!novel) {
    throw new CharactersExportError("Novel not found", 404);
  }

  let characters = await Character.find({ novel: novelId }).lean();

  if (!characters.length) {
    const fromMaster = extractCharacterDossierBlocksFromMasterPrompt(
      novel.masterPrompt || ""
    );
    if (fromMaster.length) {
      characters = fromMaster.map((entry, idx) => ({
        _id: `mp-${idx}`,
        name: entry.name,
        character: entry.characterType || "supporting character",
        role: entry.roleInStory,
        responseText: entry.dossierText || "",
      }));
    }
  }

  if (!characters.length) {
    characters = buildFallbackCastFromNovel(novel, novelId);
  }

  characters = sortCharactersForExport(characters);

  if (!hasCharactersExportContent(characters)) {
    throw new CharactersExportError(
      "No character dossiers found for this novel",
      404
    );
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
    outlineCenteredTitleParagraph("Character Dossiers", { size: 32 }),
    outlineCenteredTitleParagraph(""),
    outlineCenteredTitleParagraph("by", { italics: true, size: 28 }),
    outlineCenteredTitleParagraph(authorName || "", { size: 32 }),
  ];

  const bodyChildren = [];

  for (const character of characters) {
    const text = String(character.responseText || "").trim();
    if (!text) continue;

    bodyChildren.push(
      outlineSectionTitleParagraph(
        stripMarkdownForDocx(characterHeading(character)),
        1
      )
    );
    bodyChildren.push(...outlineMarkdownToDocxParagraphs(text));
    bodyChildren.push(outlineSpacerParagraph(240));
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
                children: parseInlineRuns("No character dossiers available."),
              }),
            ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return {
    buffer,
    filename: buildSafeCharactersFilename(novel.name),
  };
};
