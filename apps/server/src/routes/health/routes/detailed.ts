/**
 * GET /detailed endpoint - Detailed health check
 */

import type { Request, Response } from 'express';
import { getAuthStatus } from '../../../lib/auth.js';
import { getVersion } from '../../../lib/version.js';
import { getConvexRAGService } from '../../../services/convex-rag-service.js';

export function createDetailedHandler() {
  return async (_req: Request, res: Response): Promise<void> => {
    // Check RAG service health
    const ragService = getConvexRAGService();
    const ragHealth = await ragService.checkHealth();

    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: getVersion(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      dataDir: process.env.DATA_DIR || './data',
      auth: getAuthStatus(),
      rag: ragHealth,
      env: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
      },
    });
  };
}
