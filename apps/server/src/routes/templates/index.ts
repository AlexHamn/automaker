/**
 * Templates routes
 * Provides API for cloning GitHub starter templates
 */

import { Router } from 'express';
import { createCloneHandler } from './routes/clone.js';
import type { GitHubAccountManager } from '../../services/github-account-manager.js';

export function createTemplatesRoutes(githubAccountManager?: GitHubAccountManager): Router {
  const router = Router();

  router.post('/clone', createCloneHandler(githubAccountManager));

  return router;
}
