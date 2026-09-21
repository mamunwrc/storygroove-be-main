import express from "express";
import { authenticateUserWithoutOpenAI } from "../config/tokenverify.js";
import {
  listIdeas,
  createIdea,
  getIdea,
  updateIdea,
  deleteIdea,
} from "../controllers/ideaController.js";

const ideaRoute = express.Router();

ideaRoute.get("/", authenticateUserWithoutOpenAI, listIdeas);
ideaRoute.post("/", authenticateUserWithoutOpenAI, createIdea);
ideaRoute.get("/:id", authenticateUserWithoutOpenAI, getIdea);
ideaRoute.patch("/:id", authenticateUserWithoutOpenAI, updateIdea);
ideaRoute.delete("/:id", authenticateUserWithoutOpenAI, deleteIdea);

export default ideaRoute;
