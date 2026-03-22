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
import { createGotchasHandler } from './routes/gotchas.js';
import { createIndexCodeHandler } from './routes/index-code.js';
import { createIndexProjectHandler } from './routes/index-project.js';
import { createSearchHandler } from './routes/search.js';
import { createRiskHandler } from './routes/risk.js';
import { createSimilarHandler } from './routes/similar.js';
import { createStatusHandler } from './routes/status.js';

/**
 * Create RAG router with all endpoints
 *
 * Endpoints:
 * - POST /gotchas - Search for gotchas and potential issues
 * - POST /index - Index project context and memory files
 * - POST /search - Semantic search across indexed content
 * - POST /similar - Find similar past implementations
 * - POST /status - Get indexing status for a project
 *
 * @returns Express Router configured with RAG endpoints
 */
export function createRAGRoutes(): Router {
  const router = Router();

  router.post('/gotchas', createGotchasHandler());
  router.post('/index', createIndexProjectHandler());
  router.post('/index-code', createIndexCodeHandler());
  router.post('/risk', createRiskHandler());
  router.post('/search', createSearchHandler());
  router.post('/similar', createSimilarHandler());
  router.post('/status', createStatusHandler());

  return router;
}
