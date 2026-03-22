/**
 * POST /index-code endpoint - Index codebase source files
 */

import type { Request, Response } from 'express';
import { getConvexRAGService } from '../../../services/convex-rag-service.js';
import { getErrorMessage, logError } from '../common.js';

interface IndexCodeBody {
  projectPath: string;
}

export function createIndexCodeHandler() {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { projectPath } = req.body as IndexCodeBody;

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

      const result = await ragService.indexCodebase(projectPath);

      res.json({ success: true, result });
    } catch (error) {
      logError(error, 'Code indexing failed');
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  };
}
