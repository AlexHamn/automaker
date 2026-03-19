/**
 * POST /gotchas endpoint - Search for gotchas and potential issues
 */

import type { Request, Response } from 'express';
import { getConvexRAGService } from '../../../services/convex-rag-service.js';
import { getErrorMessage, logError } from '../common.js';

interface GotchasBody {
  projectPath: string;
  taskDescription: string;
  limit?: number;
}

export function createGotchasHandler() {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { projectPath, taskDescription, limit } = req.body as GotchasBody;

      if (!projectPath || !taskDescription) {
        res
          .status(400)
          .json({ success: false, error: 'projectPath and taskDescription are required' });
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

      const result = await ragService.searchGotchas(projectPath, taskDescription, limit);

      res.json({ success: true, result });
    } catch (error) {
      logError(error, 'Gotcha search failed');
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  };
}
