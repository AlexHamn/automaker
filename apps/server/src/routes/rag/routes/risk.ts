/**
 * POST /risk endpoint - Assess feature risk based on past outcomes
 */

import type { Request, Response } from 'express';
import { getConvexRAGService } from '../../../services/convex-rag-service.js';
import { getErrorMessage, logError } from '../common.js';

interface RiskBody {
  projectPath: string;
  featureTitle: string;
  featureDescription: string;
  category?: string;
}

export function createRiskHandler() {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { projectPath, featureTitle, featureDescription, category } = req.body as RiskBody;

      if (!projectPath || !featureDescription) {
        res
          .status(400)
          .json({ success: false, error: 'projectPath and featureDescription are required' });
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

      const result = await ragService.assessFeatureRisk(
        projectPath,
        featureTitle || '',
        featureDescription,
        category
      );

      res.json({ success: true, result });
    } catch (error) {
      logError(error, 'Risk assessment failed');
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  };
}
