import mongoose from "mongoose";
import Idea from "../models/ideaModel.js";

const DEFAULT_TITLE = "Untitled Idea";

const isValidObjectId = (id) =>
  typeof id === "string" && mongoose.Types.ObjectId.isValid(id);

/**
 * GET /api/idea?page=&limit=
 * List the current user's captured ideas (newest first).
 */
export const listIdeas = async (req, res) => {
  try {
    const userId = req.user._id;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const filter = { user: userId };
    const [ideas, total] = await Promise.all([
      Idea.find(filter)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .select("title content createdAt updatedAt")
        .lean(),
      Idea.countDocuments(filter),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit) || 1);

    return res.status(200).json({
      data: ideas,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    });
  } catch (error) {
    console.error("listIdeas error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * POST /api/idea
 * Body: { title?, content? }
 */
export const createIdea = async (req, res) => {
  try {
    const userId = req.user._id;
    const rawTitle =
      typeof req.body?.title === "string" ? req.body.title.trim() : "";
    const title = rawTitle || DEFAULT_TITLE;
    const content =
      typeof req.body?.content === "string" ? req.body.content : "";

    const idea = await Idea.create({
      user: userId,
      title,
      content,
    });

    return res.status(201).json({
      message: "Idea created successfully",
      idea,
    });
  } catch (error) {
    console.error("createIdea error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * GET /api/idea/:id
 */
export const getIdea = async (req, res) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid idea id" });
    }

    const idea = await Idea.findOne({ _id: id, user: userId }).lean();
    if (!idea) {
      return res.status(404).json({ message: "Idea not found" });
    }

    return res.status(200).json({ idea });
  } catch (error) {
    console.error("getIdea error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * PATCH /api/idea/:id
 * Body: { title?, content? }
 */
export const updateIdea = async (req, res) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid idea id" });
    }

    const updates = {};
    if (typeof req.body?.title === "string") {
      const trimmed = req.body.title.trim();
      updates.title = trimmed || DEFAULT_TITLE;
    }
    if (typeof req.body?.content === "string") {
      updates.content = req.body.content;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: "No fields to update" });
    }

    const idea = await Idea.findOneAndUpdate(
      { _id: id, user: userId },
      { $set: updates },
      { new: true }
    ).lean();

    if (!idea) {
      return res.status(404).json({ message: "Idea not found" });
    }

    return res.status(200).json({
      message: "Idea updated successfully",
      idea,
    });
  } catch (error) {
    console.error("updateIdea error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * DELETE /api/idea/:id
 */
export const deleteIdea = async (req, res) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid idea id" });
    }

    const deleted = await Idea.findOneAndDelete({ _id: id, user: userId });
    if (!deleted) {
      return res.status(404).json({ message: "Idea not found" });
    }

    return res.status(200).json({ message: "Idea deleted successfully" });
  } catch (error) {
    console.error("deleteIdea error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
