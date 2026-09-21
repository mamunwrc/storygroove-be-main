// LEGACY: OpenAI Assistants API implementation -- preserved for /api/v1/*-old routes
// Do NOT modify the internal logic of any _old function below.
// New default implementations live in responsesApiService.js.

import OpenAI from "openai";
import { getStoryPrompts } from "../utils/getStoryPrompts.js";
import StoryResponse from "../models/storyResponseModel.js";
import Novel from "../models/novelModel.js";
import { getCharacterPrompts } from "../utils/getCharacterPrompts.js";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import UserContent from "../models/userContentModel.js";
import EllisSceneReview from "../models/ellisSceneReviewModel.js";
import OliviaSceneSuggestion from "../models/oliviaSceneSuggestionModel.js";

export const generateStoryFromOpenAI_old = async (
  userInput,
  userId,
  res,
  openaiKey,
  assistantId
) => {
  const openai = new OpenAI({ apiKey: openaiKey });
  const prompts = getStoryPrompts(userInput);

  try {
    const thread = await openai.beta.threads.create();
    let threadId = thread.id;
    await Novel.findByIdAndUpdate(userInput.novelId, { threadId });

    for (let i = 0; i < prompts.length; i++) {
      if (!prompts[i]) continue;

      await openai.beta.threads.messages.create(threadId, {
        role: "user",
        content: prompts[i],
      });

      const run = await openai.beta.threads.runs.create(threadId, {
        assistant_id: assistantId,
      });

      while (true) {
        const runStatus = await openai.beta.threads.runs.retrieve(
          threadId,
          run.id
        );
        if (runStatus.status === "completed") break;
      }

      const messages = await openai.beta.threads.messages.list(threadId);
      let latestMessage = messages.data[0]?.content?.[0]?.text?.value || "";
      let promptKey =
        i === 17 ? "bookblurb" : i === 18 ? "synopsis" : `scene${i - 1}`;

      if (i >= 2) {
        await StoryResponse.findOneAndUpdate(
          { novel: userInput.novelId, user: userId, promptKey },
          { responseText: latestMessage },
          { upsert: true, new: true }
        );
        if (i != 17 && i != 18) {
          const sceneIndex = ((i - 2) % 5) + 1;
          const actNumber = Math.floor((i - 2) / 5) + 1;
          await UserContent.findOneAndUpdate(
            { novelId: userInput.novelId, user: userId, promptKey },
            { sceneIndex: sceneIndex, actNumber: actNumber },
            { upsert: true, new: true }
          );
        }
      }

      if (i >= 2) {
        if (i === 17 || i === 18) {
          try {
            latestMessage = latestMessage
              .replace(/^```json/, "")
              .replace(/```$/, "")
              .trim();

            let parsedJson;
            try {
              parsedJson = JSON.parse(latestMessage);
            } catch (jsonError) {
              parsedJson = { text: latestMessage };
            }

            res.write(`data: ${JSON.stringify(parsedJson)}\n\n`);
          } catch (error) {
            res.write(`data: ${JSON.stringify({ text: latestMessage })}\n\n`);
          }
        } else {
          const responseChunk = {
            [`scene${i - 1}`]: latestMessage,
          };
          res.write(`data: ${JSON.stringify(responseChunk)}\n\n`);
        }
      }
    }
  } catch (error) {
    console.error("generateStoryFromOpenAI_old error:", error);
    const message = error?.message || "Failed to generate story";
    res.write(
      `data: ${JSON.stringify({ error: message })}\n\n`
    );
  }
};

export const generateCharacterFromOpenAI_old = async (
  userInput,
  openaiKey,
  assistantId
) => {
  const openai = new OpenAI({ apiKey: openaiKey });
  const prompts = getCharacterPrompts(userInput);

  try {
    let novel = await Novel.findById(userInput.novelId);
    const thread = await openai.beta.threads.create();
    const threadId = thread.id;
    let secondPromptResponse = "";

    for (let i = 0; i < prompts.length; i++) {
      if (!prompts[i]) continue;

      await openai.beta.threads.messages.create(threadId, {
        role: "user",
        content: prompts[i],
      });

      const run = await openai.beta.threads.runs.create(threadId, {
        assistant_id: assistantId,
      });

      while (true) {
        const runStatus = await openai.beta.threads.runs.retrieve(
          threadId,
          run.id
        );
        if (runStatus.status === "completed") break;
      }

      const messages = await openai.beta.threads.messages.list(threadId);
      let latestMessage = messages.data[0]?.content?.[0]?.text?.value || "";

      if (i === 1) {
        secondPromptResponse = latestMessage;
      }
    }

    return secondPromptResponse;
  } catch (error) {
    throw new Error("Failed to generate character");
  }
};

export const reviewByOpenAI_old = async (
  fileId,
  openaiKey,
  assistantId,
  pillar,
  chapterList,
  novelId
) => {
  const openai = new OpenAI({ apiKey: openaiKey });

  const thread = await openai.beta.threads.create();

  await openai.beta.threads.messages.create(thread.id, {
    role: "user",
    content: promptFunction(),
    attachments: [{ file_id: fileId, tools: [{ type: "file_search" }] }],
  });

  const run = await openai.beta.threads.runs.create(thread.id, {
    assistant_id: assistantId,
  });

  while (true) {
    const runStatus = await openai.beta.threads.runs.retrieve(
      thread.id,
      run.id
    );
    if (runStatus.status === "completed") break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  if (pillar === "evaluation") {
    const messages = await openai.beta.threads.messages.list(thread.id);
    const latestMessage = messages.data[0]?.content?.[0]?.text?.value || "";
    return latestMessage;
  }

  // For other pillars, process chapters one by one
  const chapterReviews = [];
  for (const chapter of chapterList) {
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: `Please provide respose for: ${chapter.name}. Just provide chapter name as headeing in bold and below that the response as requested.`,
    });

    const chapterRun = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: assistantId,
    });

    while (true) {
      const runStatus = await openai.beta.threads.runs.retrieve(
        thread.id,
        chapterRun.id
      );
      if (runStatus.status === "completed") break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    const messages = await openai.beta.threads.messages.list(thread.id);
    const chapterReview = messages.data[0]?.content?.[0]?.text?.value || "";
    chapterReviews.push({
      actNumber: chapter.actNumber,
      sceneIndex: chapter.sceneIndex,
      response: chapterReview,
    });
  }

  return chapterReviews;
};

export const generateScenesFromOliviaResponse_old = async (
  novelData,
  userId,
  res,
  openaiKey,
  assistantId
) => {
  const openai = new OpenAI({ apiKey: openaiKey });
  const prompts = getStoryPrompts(novelData);

  try {
    const thread = await openai.beta.threads.create();
    let threadId = thread.id;
    await Novel.findByIdAndUpdate(novelData.novelId, { threadId });

    for (let i = 0; i < prompts.length; i++) {
      if (!prompts[i]) continue;

      await openai.beta.threads.messages.create(threadId, {
        role: "user",
        content: prompts[i],
      });

      const run = await openai.beta.threads.runs.create(threadId, {
        assistant_id: assistantId,
      });

      while (true) {
        const runStatus = await openai.beta.threads.runs.retrieve(
          threadId,
          run.id
        );
        if (runStatus.status === "completed") break;
        if (["failed", "cancelled", "expired"].includes(runStatus.status)) {
          throw new Error(`Run failed with status: ${runStatus.status}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      const messages = await openai.beta.threads.messages.list(threadId);
      let latestMessage = messages.data[0]?.content?.[0]?.text?.value || "";
      let promptKey =
        i === 17 ? "bookblurb" : i === 18 ? "synopsis" : `scene${i - 1}`;

      if (i >= 2) {
        await StoryResponse.findOneAndUpdate(
          { novel: novelData.novelId, user: userId, promptKey },
          { responseText: latestMessage },
          { upsert: true, new: true }
        );
        if (i != 17 && i != 18) {
          const sceneIndex = ((i - 2) % 5) + 1;
          const actNumber = Math.floor((i - 2) / 5) + 1;
          await UserContent.findOneAndUpdate(
            { novelId: novelData.novelId, user: userId, promptKey },
            { sceneIndex: sceneIndex, actNumber: actNumber },
            { upsert: true, new: true }
          );
        }
      }

      if (i >= 2) {
        if (i === 17 || i === 18) {
          try {
            latestMessage = latestMessage
              .replace(/^```json/, "")
              .replace(/```$/, "")
              .trim();

            let parsedJson;
            try {
              parsedJson = JSON.parse(latestMessage);
            } catch (jsonError) {
              parsedJson = { text: latestMessage };
            }

            res.write(`data: ${JSON.stringify(parsedJson)}\n\n`);
          } catch (error) {
            res.write(`data: ${JSON.stringify({ text: latestMessage })}\n\n`);
          }
        } else {
          const responseChunk = {
            [`scene${i - 1}`]: latestMessage,
          };
          res.write(`data: ${JSON.stringify(responseChunk)}\n\n`);
        }
      }
    }
  } catch (error) {
    res.write(
      `data: ${JSON.stringify({ error: "Failed to generate scenes: " + error.message })}\n\n`
    );
  }
};

export const uploadContentFileToOpenAI_old = async (content, openaiKey) => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const filePath = path.join(__dirname, "../temp_scene.txt");
  fs.writeFileSync(filePath, content, "utf8");

  const openai = new OpenAI({ apiKey: openaiKey });

  const file = await openai.files.create({
    purpose: "assistants",
    file: fs.createReadStream(filePath),
  });

  return file.id;
};

// Helper function to parse JSON from response, handling partial responses
// Exported for reuse by responsesApiService.js
export const parseJSONResponse = (responseText) => {
  // Remove markdown code blocks if present
  let cleaned = responseText
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  // Try to find JSON object in the response
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    cleaned = jsonMatch[0];
  }

  try {
    return JSON.parse(cleaned);
  } catch (error) {
    // If parsing fails, try to extract partial JSON
    // Look for scenes array pattern
    const scenesMatch = cleaned.match(/"scenes"\s*:\s*\[([\s\S]*)\]/);
    if (scenesMatch) {
      // Try to extract individual scene objects
      const scenesText = scenesMatch[1];
      const sceneObjects = [];
      let depth = 0;
      let currentScene = "";
      let inString = false;
      let escapeNext = false;

      for (let i = 0; i < scenesText.length; i++) {
        const char = scenesText[i];
        
        if (escapeNext) {
          currentScene += char;
          escapeNext = false;
          continue;
        }

        if (char === "\\") {
          escapeNext = true;
          currentScene += char;
          continue;
        }

        if (char === '"' && !escapeNext) {
          inString = !inString;
        }

        if (!inString) {
          if (char === "{") {
            depth++;
          } else if (char === "}") {
            depth--;
            if (depth === 0) {
              currentScene += char;
              try {
                const sceneObj = JSON.parse(currentScene);
                sceneObjects.push(sceneObj);
              } catch (e) {
                // Skip malformed scene
              }
              currentScene = "";
              continue;
            }
          }
        }

        if (depth > 0) {
          currentScene += char;
        }
      }

      if (sceneObjects.length > 0) {
        return { scenes: sceneObjects };
      }
    }

    throw new Error(`Failed to parse JSON: ${error.message}`);
  }
};

// Helper function to validate and store Ellis scene reviews
export const storeEllisSceneReviews = async (novelId, userId, scenesData) => {
  if (!Array.isArray(scenesData)) {
    throw new Error("Scenes data must be an array");
  }

  const storedScenes = [];

  for (const scene of scenesData) {
    // Validate required fields
    if (
      typeof scene.scene_index !== "number" ||
      !scene.scene_status ||
      !scene.function_in_story ||
      !scene.genre_beat_check ||
      !scene.structure_evaluation ||
      !scene.character_evaluation ||
      !scene.scene_analysis
    ) {
      console.warn(`Skipping invalid scene at index ${scene.scene_index || "unknown"}`);
      continue;
    }

    // Store or update scene review
    const sceneReview = await EllisSceneReview.findOneAndUpdate(
      {
        novel: novelId,
        user: userId,
        scene_index: scene.scene_index,
      },
      {
        novel: novelId,
        user: userId,
        scene_index: scene.scene_index,
        chapter_label: scene.chapter_label || null,
        pov: scene.pov || null,
        scene_status: scene.scene_status,
        function_in_story: scene.function_in_story,
        genre_beat_check: scene.genre_beat_check,
        structure_evaluation: scene.structure_evaluation,
        character_evaluation: scene.character_evaluation,
        scene_analysis: scene.scene_analysis,
        creative_suggestions: Array.isArray(scene.creative_suggestions)
          ? scene.creative_suggestions
          : [],
      },
      { upsert: true, new: true }
    );

    storedScenes.push(sceneReview);
  }

  return storedScenes;
};

// Helper function to validate and store Olivia Scene Design records
export const storeOliviaSceneSuggestions = async (novelId, userId, scenesData) => {
  if (!Array.isArray(scenesData)) {
    throw new Error("Scenes data must be an array");
  }

  // Ensure we only process up to 15 scenes and log if the count is off
  if (scenesData.length !== 15) {
    console.warn(
      `Olivia scenes response has ${scenesData.length} scenes instead of 15`
    );
  }

  const storedScenes = [];

  for (const scene of scenesData) {
    // Validate required fields
    if (
      typeof scene.scene_index !== "number" ||
      !scene.structural_role ||
      !scene.what_happens ||
      !scene.protagonist_emotional_shift ||
      !scene.plot_advancement ||
      !scene.craft_or_coaching_note
    ) {
      console.warn(`Skipping invalid scene at index ${scene.scene_index || "unknown"}`);
      continue;
    }

    // Store or update Scene Design record
    const sceneSuggestion = await OliviaSceneSuggestion.findOneAndUpdate(
      {
        novel: novelId,
        user: userId,
        scene_index: scene.scene_index,
      },
      {
        novel: novelId,
        user: userId,
        scene_index: scene.scene_index,
        book_coaching: scene.book_coaching || null,
        subplot_reminder: scene.subplot_reminder || null,
        genre_specific_coaching: scene.genre_specific_coaching || null,
        target_word_count: scene.target_word_count || null,
        structural_role: scene.structural_role,
        what_happens: scene.what_happens,
        setting: scene.setting || null,
        significant_actions: scene.significant_actions || null,
        protagonist_emotional_shift: scene.protagonist_emotional_shift,
        emotional_reactions: scene.emotional_reactions || null,
        plot_advancement: scene.plot_advancement,
        subplot_integration: scene.subplot_integration || null,
        character_arc_movement: scene.character_arc_movement || null,
        craft_or_coaching_note: scene.craft_or_coaching_note,
      },
      { upsert: true, new: true }
    );

    storedScenes.push(sceneSuggestion);
  }

  return storedScenes;
};

export const ellisReviewByOpenAI_old = async (
  fileId,
  openaiKey,
  assistantId,
  novelId,
  userId
) => {
  const openai = new OpenAI({ apiKey: openaiKey });

  const thread = await openai.beta.threads.create();

  await openai.beta.threads.messages.create(thread.id, {
    role: "user",
    content:
      "Please read and review the attached manuscript. Analyze each scene and provide a JSON response with the following structure: { \"scenes\": [] }. Each scene object should contain: scene_index (integer), chapter_label (string or null), pov (string or null), scene_status (\"Analyzed\" or \"Not Present in Manuscript\"), function_in_story (string), genre_beat_check (string), structure_evaluation (\"Keep\", \"Tighten\", \"Rewrite\", \"Move\", or \"Cut\"), character_evaluation (\"Keep\", \"Deepen\", or \"Rework\"), scene_analysis (1-2 editorial paragraphs), and creative_suggestions (array of strings). Respond with valid JSON only.",
    attachments: [{ file_id: fileId, tools: [{ type: "file_search" }] }],
  });

  const run = await openai.beta.threads.runs.create(thread.id, {
    assistant_id: assistantId,
  });

  let runStatus;
  let attempts = 0;
  const maxAttempts = 300; // 5 minutes max wait time

  while (attempts < maxAttempts) {
    runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
    
    if (runStatus.status === "completed") {
      break;
    }
    
    if (["failed", "cancelled", "expired"].includes(runStatus.status)) {
      throw new Error(`Ellis run failed with status: ${runStatus.status}`);
    }

    // Check if run requires action (e.g., function calling)
    if (runStatus.status === "requires_action") {
      // For now, we'll just wait - in production you might want to handle tool calls
      await new Promise((resolve) => setTimeout(resolve, 2000));
      attempts++;
      continue;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
    attempts++;
  }

  if (attempts >= maxAttempts) {
    throw new Error("Ellis review timed out");
  }

  // Get all messages to handle potential partial responses
  const messages = await openai.beta.threads.messages.list(thread.id, {
    order: "asc",
  });

  // Combine all assistant messages to handle partial responses
  let fullResponse = "";
  for (const message of messages.data) {
    if (message.role === "assistant") {
      const textContent = message.content
        .filter((c) => c.type === "text")
        .map((c) => c.text.value)
        .join("\n");
      fullResponse += textContent;
    }
  }

  // Try to parse JSON response
  let parsedResponse;
  try {
    parsedResponse = parseJSONResponse(fullResponse);
  } catch (error) {
    // If parsing fails completely, return the raw response for debugging
    console.error("Failed to parse Ellis response:", error);
    throw new Error(`Failed to parse Ellis response as JSON: ${error.message}`);
  }

  // Validate response structure
  if (!parsedResponse.scenes || !Array.isArray(parsedResponse.scenes)) {
    throw new Error("Invalid response structure: missing scenes array");
  }

  // Store scenes in database
  if (novelId && userId) {
    await storeEllisSceneReviews(novelId, userId, parsedResponse.scenes);
  }

  return parsedResponse;
};

// Function to process Olivia scenes JSON response
export const processOliviaScenesResponse_old = async (
  responseText,
  novelId,
  userId
) => {
  try {
    const parsedResponse = parseJSONResponse(responseText);

    // Validate response structure
    if (!parsedResponse.scenes || !Array.isArray(parsedResponse.scenes)) {
      throw new Error("Invalid response structure: missing scenes array");
    }

    // Store scenes in database
    if (novelId && userId) {
      await storeOliviaSceneSuggestions(novelId, userId, parsedResponse.scenes);
    }

    return parsedResponse;
  } catch (error) {
    console.error("Failed to process Olivia scenes response:", error);
    throw error;
  }
};

// Function to call olivia-scenes agent with a document and process JSON response
export const oliviaScenesByOpenAI_old = async (
  fileId,
  openaiKey,
  assistantId,
  novelId,
  userId
) => {
  const openai = new OpenAI({ apiKey: openaiKey });

  const thread = await openai.beta.threads.create();

  await openai.beta.threads.messages.create(thread.id, {
    role: "user",
    content:
      "Please read the attached document and design a 15-beat scene outline for the novel. Respond ONLY with valid JSON in the following structure:\n\n{\n  \"scenes\": [\n    {\n      \"scene_index\": 1,\n      \"structural_role\": \"\",\n      \"what_happens\": \"High-level summary only, no prose.\",\n      \"protagonist_emotional_shift\": \"\",\n      \"plot_advancement\": \"\",\n      \"subplot_integration\": \"\" | null,\n      \"craft_or_coaching_note\": \"\"\n    },\n    // ... up to scene_index 15\n  ]\n}\n\nRules:\n- \"scenes\" MUST be an array of exactly 15 objects.\n- Each \"scene_index\" MUST be an integer from 1 to 15.\n- Do NOT include any keys other than the ones above in each scene object.\n- Do NOT include any explanatory text before or after the JSON.",
    attachments: [{ file_id: fileId, tools: [{ type: "file_search" }] }],
  });

  const run = await openai.beta.threads.runs.create(thread.id, {
    assistant_id: assistantId,
  });

  let runStatus;
  let attempts = 0;
  const maxAttempts = 300; // 5 minutes max wait time

  while (attempts < maxAttempts) {
    runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
    
    if (runStatus.status === "completed") {
      break;
    }
    
    if (["failed", "cancelled", "expired"].includes(runStatus.status)) {
      throw new Error(`Olivia scenes run failed with status: ${runStatus.status}`);
    }

    // Check if run requires action (e.g., function calling)
    if (runStatus.status === "requires_action") {
      // For now, we'll just wait - in production you might want to handle tool calls
      await new Promise((resolve) => setTimeout(resolve, 2000));
      attempts++;
      continue;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
    attempts++;
  }

  if (attempts >= maxAttempts) {
    throw new Error("Olivia scenes review timed out");
  }

  // Get all messages to handle potential partial responses
  const messages = await openai.beta.threads.messages.list(thread.id, {
    order: "asc",
  });

  // Combine all assistant messages to handle partial responses
  let fullResponse = "";
  for (const message of messages.data) {
    if (message.role === "assistant") {
      const textContent = message.content
        .filter((c) => c.type === "text")
        .map((c) => c.text.value)
        .join("\n");
      fullResponse += textContent;
    }
  }

  // Try to parse JSON response
  let parsedResponse;
  try {
    parsedResponse = parseJSONResponse(fullResponse);
  } catch (error) {
    // If parsing fails completely, return the raw response for debugging
    console.error("Failed to parse Olivia scenes response:", error);
    throw new Error(`Failed to parse Olivia scenes response as JSON: ${error.message}`);
  }

  // Validate response structure
  if (!parsedResponse.scenes || !Array.isArray(parsedResponse.scenes)) {
    throw new Error("Invalid response structure: missing scenes array");
  }

  // Store scenes in database
  if (novelId && userId) {
    await storeOliviaSceneSuggestions(novelId, userId, parsedResponse.scenes);
  }

  return parsedResponse;
};

// Function to upload docx file to OpenAI
export const uploadDocFileToOpenAI_old = async (fileBuffer, openaiKey, fileName = "document.docx") => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const tempFilePath = path.join(__dirname, "../temp", fileName);

  // Ensure temp directory exists
  const tempDir = path.dirname(tempFilePath);
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  // Write buffer to temp file
  fs.writeFileSync(tempFilePath, fileBuffer);

  const openai = new OpenAI({ apiKey: openaiKey });

  const file = await openai.files.create({
    purpose: "assistants",
    file: fs.createReadStream(tempFilePath),
  });

  // Clean up temp file
  try {
    fs.unlinkSync(tempFilePath);
  } catch (error) {
    console.warn("Failed to delete temp file:", error);
  }

  return file.id;
};
