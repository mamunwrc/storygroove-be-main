/**
 * Authoritative layering state for Olivia editor (Insert button + focus resolver).
 */

import Novel from "../models/novelModel.js";
import Message from "../models/messageModel.js";
import UserContent from "../models/userContentModel.js";
import {
  computeLayeringState,
  findLatestLayeringTableTextFromMessages,
} from "../utils/oliviaLayeringParse.js";

export const getLayeringStateForNovel = async (novelId, userId) => {
  const novel = await Novel.findOne({ _id: novelId, user: userId })
    .select("oliviaEditorThreadId oliviaLayeredInserts")
    .lean();
  if (!novel?.oliviaEditorThreadId) {
    return { layeringRows: [], nextLayeringTarget: null, allDone: false, tableText: null };
  }
  const [editorMsgs, userContents] = await Promise.all([
    Message.find({ threadId: novel.oliviaEditorThreadId })
      .sort({ timestamp: 1 })
      .select("role content")
      .lean(),
    UserContent.find({ novelId, user: userId })
      .select("promptKey actNumber sceneIndex")
      .lean(),
  ]);
  const tableText = findLatestLayeringTableTextFromMessages(editorMsgs);
  return computeLayeringState({
    tableText,
    oliviaLayeredInserts: novel.oliviaLayeredInserts,
    userContents,
  });
};
