/**
 * Enhance prompt routes - HTTP API for AI-powered text enhancement
 *
 * Provides endpoints for enhancing user input text using Claude AI
 * with different enhancement modes (improve, expand, simplify, etc.)
 */

import { Router } from "express";
import { createEnhanceHandler } from "./routes/enhance.js";

/**
 * Create the enhance-prompt router
 *
 * @returns Express router with enhance-prompt endpoints
 */
export function createEnhancePromptRoutes(): Router {
  const router = Router();

  router.post("/", createEnhanceHandler());

  return router;
}
