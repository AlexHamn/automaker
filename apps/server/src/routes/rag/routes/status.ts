/**
 * POST /status endpoint - Get indexing status for a project
 */

import type { Request, Response } from 'express';
import { getConvexRAGService } from '../../../services/convex-rag-service.js';
import { getProjectId } from '../../../lib/file-utils.js';
import { getErrorMessage, logError } from '../common.js';

interface StatusBody {
  projectPath: string;
}

export function createStatusHandler() {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { projectPath } = req.body as StatusBody;

      if (!projectPath) {
        res.status(400).json({ success: false, error: 'projectPath is required' });
        return;
      }

      const ragService = getConvexRAGService();
      const configStatus = ragService.getConfigStatus();

      if (!ragService.isAvailable()) {
        res.json({
          success: true,
          status: {
            ...configStatus,
            projectId: getProjectId(projectPath),
            indexed: false,
            files: [],
          },
        });
        return;
      }

      // Query Convex for indexed content
      const client = ragService.getClient();
      if (!client) {
        res.json({
          success: true,
          status: {
            ...configStatus,
            projectId: getProjectId(projectPath),
            indexed: false,
            files: [],
          },
        });
        return;
      }

      const projectId = getProjectId(projectPath);

      try {
        const { makeFunctionReference } = await import('convex/server');
        const ref = makeFunctionReference<'query'>('indexing:listProjectContent');
        const files = await client.query(ref, { projectId });

        res.json({
          success: true,
          status: {
            ...configStatus,
            projectId,
            indexed: files.length > 0,
            fileCount: files.length,
            files: files.map(
              (f: { filePath: string; contentType: string; lastIndexed: number }) => ({
                filePath: f.filePath,
                contentType: f.contentType,
                lastIndexed: new Date(f.lastIndexed).toISOString(),
              })
            ),
          },
        });
      } catch (error) {
        // If query fails, return basic status
        res.json({
          success: true,
          status: {
            ...configStatus,
            projectId,
            indexed: false,
            files: [],
            error: getErrorMessage(error),
          },
        });
      }
    } catch (error) {
      logError(error, 'Get RAG status failed');
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  };
}
