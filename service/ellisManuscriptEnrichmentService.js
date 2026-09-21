/**
 * Post–editorial-letter enrichment for uploaded manuscripts: functional chapter
 * summaries (Manuscript Map) and 3-act assignment when acts are not in the draft.
 */
import OpenAI from "openai";
import { ELLIS_MODEL } from "../constants/models.js";
import Novel from "../models/novelModel.js";
import UserContent from "../models/userContentModel.js";
import { getSharedOpenAIKey } from "../controllers/chatController.js";
import {
  assembleManuscriptText,
  buildUploadedManuscriptMetaLines,
  extractChapterFirstLine,
} from "../utils/manuscriptText.js";
import {
  callResponsesAPI,
  extractTextFromOutput,
} from "./responsesApiService.js";
import { parseJSONResponse } from "./openaiService.js";

export { extractChapterFirstLine };

const ENRICHMENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    chapters: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          chapterNumber: { type: "integer" },
          summary: { type: "string" },
          actNumber: { type: "integer" },
        },
        required: ["chapterNumber", "summary", "actNumber"],
      },
    },
  },
  required: ["chapters"],
};

const buildGenreContext = (novel) =>
  buildUploadedManuscriptMetaLines(novel).join("\n");

/**
 * Generate functional chapter summaries and act numbers for an uploaded manuscript.
 */
export const generateManuscriptEnrichment = async ({ novelId, userId }) => {
  try {
    await Novel.findByIdAndUpdate(novelId, {
      manuscriptEnrichmentStatus: "generating",
      manuscriptEnrichmentError: null,
    });

    const novel = await Novel.findOne({ _id: novelId, user: userId })
      .select("genre subgenre compTitles storyBibleAuthor editorialLetter")
      .lean();
    if (!novel) throw new Error("Novel not found");

    const userContents = await UserContent.find({ novelId, user: userId })
      .select(
        "_id userContent sceneTitle sceneIndex chapterNumber chapterLabel pov timeline actNumber chapterSummary archivedAt"
      )
      .sort({ createdAt: 1 })
      .lean();

    const manuscriptText = assembleManuscriptText(userContents);
    if (!manuscriptText.trim()) {
      throw new Error("No manuscript content available for enrichment.");
    }

    const chapterList = userContents
      .filter((uc) => uc.chapterNumber != null && !uc.archivedAt)
      .map((uc) => {
        const label =
          uc.chapterLabel ||
          uc.sceneTitle ||
          `Chapter ${uc.chapterNumber}`;
        const meta = [
          uc.pov ? `POV: ${uc.pov}` : null,
          uc.timeline ? `Timeline: ${uc.timeline}` : null,
        ]
          .filter(Boolean)
          .join(", ");
        return `- Chapter ${uc.chapterNumber}: ${label}${meta ? ` (${meta})` : ""}`;
      })
      .join("\n");

    const genreContext = buildGenreContext(novel);
    const instructions = `You are Ellis, a developmental editor. The manuscript has already received a global editorial letter.

For EACH chapter listed below, produce:
1. summary — a functional beat description (what the chapter is DOING in the story arc: e.g. "Opening Image / Comic Disaster Hook", "Midpoint pressure stack") — NOT a plot recap or excerpt of prose.
2. actNumber — assign 1, 2, or 3 based on structural position (Act 1 setup, Act 2 confrontation, Act 3 resolution). If the manuscript already implies act breaks, honor them; otherwise infer a standard three-act split.

Return STRICT JSON only matching the schema.`;

    const openaiKey = await getSharedOpenAIKey();
    const openai = new OpenAI({ apiKey: openaiKey });

    const response = await callResponsesAPI({
      openai,
      model: ELLIS_MODEL,
      instructions,
      input: [
        {
          role: "user",
          content: [
            genreContext ? `MANUSCRIPT METADATA:\n${genreContext}\n` : "",
            `CHAPTERS TO ENRICH:\n${chapterList}\n\nFULL MANUSCRIPT:\n\n${manuscriptText}`,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
      temperature: 0.3,
      text: {
        format: {
          type: "json_schema",
          name: "ManuscriptEnrichment",
          schema: ENRICHMENT_SCHEMA,
          strict: true,
        },
      },
      logParams: { userId, endpoint: "ellis-manuscript-enrichment" },
    });

    const raw = extractTextFromOutput(response.output);
    const parsed = parseJSONResponse(raw);
    if (!parsed?.chapters || !Array.isArray(parsed.chapters)) {
      throw new Error("Enrichment returned malformed JSON.");
    }

    for (const row of parsed.chapters) {
      const num = Number(row.chapterNumber);
      if (!Number.isFinite(num)) continue;
      const uc = userContents.find(
        (c) => Number(c.chapterNumber || c.sceneIndex) === num
      );
      if (!uc) continue;

      const patch = {};
      if (row.summary && String(row.summary).trim()) {
        patch.chapterSummary = String(row.summary).trim();
      }
      const act = Number(row.actNumber);
      if (Number.isFinite(act) && act >= 1 && act <= 3) {
        if (uc.actNumber == null) patch.actNumber = act;
      }
      if (Object.keys(patch).length) {
        await UserContent.findByIdAndUpdate(uc._id, { $set: patch });
      }
    }

    await Novel.findByIdAndUpdate(novelId, {
      manuscriptEnrichmentStatus: "ready",
      manuscriptEnrichmentError: null,
      manuscriptEnrichmentGeneratedAt: new Date(),
    });
  } catch (error) {
    console.error("generateManuscriptEnrichment error:", error);
    await Novel.findByIdAndUpdate(novelId, {
      manuscriptEnrichmentStatus: "failed",
      manuscriptEnrichmentError:
        error.message || "Manuscript enrichment generation failed",
    }).catch(() => {});
  }
};
