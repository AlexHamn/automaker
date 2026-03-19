/**
 * POST /search endpoint - Semantic search across indexed project content
 */

import type { Request, Response } from 'express';
import { getConvexRAGService } from '../../../services/convex-rag-service.js';
import { getErrorMessage, logError } from '../common.js';

interface SearchBody {
  projectPath: string;
  query: string;
  contentType?: string;
  limit?: number;
}

export function createSearchHandler() {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { projectPath, query, contentType, limit } = req.body as SearchBody;

      if (!projectPath || !query) {
        res.status(400).json({ success: false, error: 'projectPath and query are required' });
        return;
      }

      const ragService = getConvexRAGService();

      if (!ragService.isAvailable()) {
        res.status(503).json({
          success: false,
          error: 'RAG service is not available',
          details: ragService.getConfigStatus(),
        });
        return;
      }

      const result = await ragService.searchFeatureContext(projectPath, query, {
        contentType,
        limit,
      });

      res.json({ success: true, result });
    } catch (error) {
      logError(error, 'RAG search failed');
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  };
}
