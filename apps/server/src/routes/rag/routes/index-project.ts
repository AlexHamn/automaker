/**
 * POST /index endpoint - Index project context and memory files
 */

import type { Request, Response } from 'express';
import { getConvexRAGService } from '../../../services/convex-rag-service.js';
import { getErrorMessage, logError } from '../common.js';

interface IndexProjectBody {
  projectPath: string;
}

export function createIndexProjectHandler() {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { projectPath } = req.body as IndexProjectBody;

      if (!projectPath) {
        res.status(400).json({ success: false, error: 'projectPath is required' });
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

      const result = await ragService.indexProject(projectPath);

      res.json({ success: true, result });
    } catch (error) {
      logError(error, 'Index project failed');
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  };
}
