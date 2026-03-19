/**
 * POST /similar endpoint - Find similar past implementations
 */

import type { Request, Response } from 'express';
import { getConvexRAGService } from '../../../services/convex-rag-service.js';
import { getErrorMessage, logError } from '../common.js';

interface SimilarBody {
  projectPath: string;
  description: string;
  category?: string;
  limit?: number;
}

export function createSimilarHandler() {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { projectPath, description, category, limit } = req.body as SimilarBody;

      if (!projectPath || !description) {
        res.status(400).json({ success: false, error: 'projectPath and description are required' });
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

      const result = await ragService.findSimilarImplementations(
        projectPath,
        description,
        category,
        limit
      );

      res.json({ success: true, result });
    } catch (error) {
      logError(error, 'Similar implementations search failed');
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  };
}
