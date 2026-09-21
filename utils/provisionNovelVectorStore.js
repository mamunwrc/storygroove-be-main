// Olivia memory pipeline — Phase 3 per-novel vector store helper.
//
// Each novel gets its own OpenAI hosted vector store containing one
// `.md` file per finalized scene. The model can then call
// `file_search` (alongside the platform-wide methodology store) to
// answer "what happened with X in scene 7?" without us re-reading
// every scene's raw prose.
//
// All operations are best-effort and idempotent:
//   - `provisionNovelVectorStore` no-ops if the novel already has a
//     `oliviaSceneMemoryVectorStoreId`.
//   - `syncSceneMemoryToVectorStore` replaces the prior per-scene
//     file when a scene is updated.
//   - `purgeSceneFromVectorStore` removes a per-scene file when a
//     scene is deleted (called by `memoryInvalidator.onSceneDelete`).
//
// We never throw into the caller. Failures log and return `false` so
// the caller continues; the next save attempt will retry.

import OpenAI from "openai";
import https from "https";
import Novel from "../models/novelModel.js";
import SceneMemory from "../models/sceneMemoryModel.js";

const getHttpsAgent = () => {
  const isProduction = process.env.NODE_ENV === "production";
  let rejectUnauthorized;
  if (process.env.REJECT_UNAUTHORIZED !== undefined) {
    rejectUnauthorized = process.env.REJECT_UNAUTHORIZED !== "false";
  } else {
    rejectUnauthorized = isProduction;
  }
  return new https.Agent({ rejectUnauthorized });
};

const getOpenAIClient = (apiKey) => {
  const agent = getHttpsAgent();
  return new OpenAI({ apiKey, httpAgent: agent, httpsAgent: agent });
};

const safeFileName = (sceneRef) =>
  `scene_${sceneRef.actNumber}_${sceneRef.sceneIndex}.md`;

/**
 * Resolve the `vectorStores` namespace across the various OpenAI SDK
 * surfaces. Older SDKs expose `client.beta.vectorStores`; newer ones
 * also expose `client.vectorStores`. We pick whichever exists.
 */
const vsApi = (openai) =>
  openai.vectorStores || openai.beta?.vectorStores || null;

const fileBlob = (text) =>
  // OpenAI SDK accepts a Web Blob for upload. We attach a synthetic
  // `name` because the SDK forwards multipart filename headers.
  new Blob([text || ""], { type: "text/markdown" });

/**
 * Ensure the given novel has a vector store id. If missing, create
 * one via OpenAI and persist the id on the Novel row. Returns the
 * resolved id (or `null` on hard failure).
 */
export const provisionNovelVectorStore = async ({ novelId, openaiKey }) => {
  if (!novelId || !openaiKey) return null;

  try {
    const novel = await Novel.findById(novelId).select(
      "_id name oliviaSceneMemoryVectorStoreId"
    );
    if (!novel) return null;
    if (novel.oliviaSceneMemoryVectorStoreId) {
      return novel.oliviaSceneMemoryVectorStoreId;
    }

    const openai = getOpenAIClient(openaiKey);
    const api = vsApi(openai);
    if (!api?.create) {
      console.error(
        "provisionNovelVectorStore: vectorStores API not available in installed openai SDK"
      );
      return null;
    }
    const store = await api.create({
      name: `olivia-novel-${String(novelId)}`,
      metadata: { kind: "olivia-scene-memory", novelId: String(novelId) },
    });

    novel.oliviaSceneMemoryVectorStoreId = store.id;
    await novel.save();
    return store.id;
  } catch (err) {
    console.error(
      "provisionNovelVectorStore failed (non-blocking):",
      err?.message || err
    );
    return null;
  }
};

const buildSceneMemoryMarkdown = (memory) => {
  if (!memory) return "";
  const lines = [];
  lines.push(`# Act ${memory.sceneRef?.actNumber}, Scene ${memory.sceneRef?.sceneIndex}`);
  if (memory.title) lines.push(`**Title:** ${memory.title}`);
  if (memory.pov) lines.push(`**POV:** ${memory.pov}`);
  lines.push("");
  if (memory.summary) {
    lines.push("## Summary");
    lines.push(memory.summary);
    lines.push("");
  }
  if (memory.stateChanges?.length) {
    lines.push("## State Changes");
    for (const s of memory.stateChanges) lines.push(`- ${s}`);
    lines.push("");
  }
  if (memory.unresolvedThreads?.length) {
    lines.push("## Unresolved Threads");
    for (const t of memory.unresolvedThreads) lines.push(`- ${t}`);
    lines.push("");
  }
  if (memory.importantFacts?.length) {
    lines.push("## Important Facts");
    for (const f of memory.importantFacts) lines.push(`- ${f}`);
    lines.push("");
  }
  return lines.join("\n");
};

/**
 * Lookup helper: list any files in the store that match the scene's
 * `act_X_scene_Y.md` name so we can delete them before uploading the
 * fresh version. OpenAI does not yet expose a "delete by metadata"
 * primitive, so we filter client-side.
 */
const findMatchingFileIds = async (openai, vectorStoreId, fileName) => {
  const api = vsApi(openai);
  if (!api?.files?.list) return [];
  const matches = [];
  try {
    let page = await api.files.list(vectorStoreId, { limit: 100 });
    while (page?.data?.length) {
      for (const f of page.data) {
        // The hosted store keeps the upload filename in `attributes`
        // (varies by SDK version). We're conservative — match on any
        // attribute or top-level field containing our filename.
        const fields = [f.attributes?.filename, f.filename, f.name].filter(
          Boolean
        );
        if (fields.some((v) => String(v).endsWith(fileName))) {
          matches.push(f.id);
        }
      }
      if (!page.hasNextPage?.()) break;
      // eslint-disable-next-line no-await-in-loop
      page = await page.getNextPage();
    }
  } catch (err) {
    console.warn(
      "findMatchingFileIds failed (non-blocking):",
      err?.message || err
    );
  }
  return matches;
};

/**
 * Upload the markdown for `SceneMemory[novelId, sceneRef]` to the
 * novel's vector store, replacing any prior file for that scene.
 *
 * Idempotent: re-running on unchanged data uploads a fresh file (the
 * model treats them as equivalent — at worst we double up briefly
 * before the prior file is deleted).
 */
export const syncSceneMemoryToVectorStore = async ({
  novelId,
  sceneRef,
  openaiKey,
}) => {
  if (!novelId || !sceneRef || !openaiKey) return false;
  try {
    const vectorStoreId = await provisionNovelVectorStore({ novelId, openaiKey });
    if (!vectorStoreId) return false;

    const memory = await SceneMemory.findOne({
      novelId,
      "sceneRef.actNumber": sceneRef.actNumber,
      "sceneRef.sceneIndex": sceneRef.sceneIndex,
    }).lean();
    if (!memory || !memory.summary?.trim()) return false;

    const openai = getOpenAIClient(openaiKey);
    const api = vsApi(openai);
    if (!api?.files?.uploadAndPoll && !api?.fileBatches?.uploadAndPoll) {
      console.error(
        "syncSceneMemoryToVectorStore: vectorStores files API not available"
      );
      return false;
    }

    const fileName = safeFileName(sceneRef);
    const body = buildSceneMemoryMarkdown(memory);

    // Drop prior file(s) for this scene before uploading the new one
    // — keeps the store from accumulating multiple revisions.
    const existing = await findMatchingFileIds(openai, vectorStoreId, fileName);
    for (const fid of existing) {
      try {
        await api.files.delete?.(vectorStoreId, fid);
      } catch (delErr) {
        console.warn(
          `syncSceneMemoryToVectorStore: stale file delete failed (non-blocking) for ${fid}:`,
          delErr?.message || delErr
        );
      }
    }

    const blob = fileBlob(body);
    // OpenAI's SDK accepts a File-like wrapper with `name`.
    const file = new File([blob], fileName, { type: "text/markdown" });
    if (api.files?.uploadAndPoll) {
      await api.files.uploadAndPoll(vectorStoreId, file);
    } else if (api.fileBatches?.uploadAndPoll) {
      await api.fileBatches.uploadAndPoll(vectorStoreId, { files: [file] });
    }
    return true;
  } catch (err) {
    console.error(
      "syncSceneMemoryToVectorStore failed (non-blocking):",
      err?.message || err
    );
    return false;
  }
};

/**
 * Remove a scene's file from the novel vector store. Called by
 * `memoryInvalidator.onSceneDelete` so stale chunks don't haunt
 * future retrievals.
 */
export const purgeSceneFromVectorStore = async ({
  novelId,
  sceneRef,
  openaiKey,
}) => {
  if (!novelId || !sceneRef || !openaiKey) return false;
  try {
    const novel = await Novel.findById(novelId)
      .select("oliviaSceneMemoryVectorStoreId")
      .lean();
    const vectorStoreId = novel?.oliviaSceneMemoryVectorStoreId;
    if (!vectorStoreId) return false;

    const openai = getOpenAIClient(openaiKey);
    const api = vsApi(openai);
    if (!api?.files?.delete) return false;

    const fileName = safeFileName(sceneRef);
    const existing = await findMatchingFileIds(openai, vectorStoreId, fileName);
    for (const fid of existing) {
      try { await api.files.delete(vectorStoreId, fid); } catch {}
    }
    return true;
  } catch (err) {
    console.error(
      "purgeSceneFromVectorStore failed (non-blocking):",
      err?.message || err
    );
    return false;
  }
};
