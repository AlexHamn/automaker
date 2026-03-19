/**
 * POST /list endpoint - List all features for a project
 */

import type { Request, Response } from 'express';
import { FeatureLoader } from '../../../services/feature-loader.js';
import { getConvexRAGService } from '../../../services/convex-rag-service.js';
import { getFileWatcherService } from '../../../services/file-watcher-service.js';
import { getErrorMessage, logError } from '../common.js';

export function createListHandler(featureLoader: FeatureLoader) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { projectPath } = req.body as { projectPath: string };

      if (!projectPath) {
        res.status(400).json({ success: false, error: 'projectPath is required' });
        return;
      }

      const features = await featureLoader.getAll(projectPath);
      res.json({ success: true, features });

      // Fire-and-forget RAG indexing (non-blocking)
      const ragService = getConvexRAGService();
      if (ragService.isAvailable()) {
        ragService.indexProjectIfStale(projectPath).catch(() => {});
        // Start watching this project for file changes (idempotent)
        const watcher = getFileWatcherService();
        if (watcher) {
          watcher.watchProject(projectPath);
        }
      }
    } catch (error) {
      logError(error, 'List features failed');
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  };
}
