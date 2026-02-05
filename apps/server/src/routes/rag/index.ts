/**
 * RAG routes - HTTP API for RAG indexing operations
 *
 * Provides endpoints for:
 * - Indexing project context and memory files
 * - Checking indexing status
 *
 * Mounted at /api/rag in the main server.
 */

import { Router } from 'express';
import { createIndexProjectHandler } from './routes/index-project.js';
import { createStatusHandler } from './routes/status.js';

/**
 * Create RAG router with all endpoints
 *
 * Endpoints:
 * - POST /index - Index project context and memory files
 * - POST /status - Get indexing status for a project
 *
 * @returns Express Router configured with RAG endpoints
 */
export function createRAGRoutes(): Router {
  const router = Router();

  router.post('/index', createIndexProjectHandler());
  router.post('/status', createStatusHandler());

  return router;
}
