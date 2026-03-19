/**
 * GitHub Accounts routes - CRUD for GitHub account management
 *
 * Endpoints:
 * - GET /          - Get all accounts (masked tokens)
 * - POST /         - Add new account { name, token }
 * - PUT /:id       - Update account { name?, enabled? }
 * - DELETE /:id    - Delete account
 * - POST /capture-token - Capture token from local gh CLI auth
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import type { GitHubAccountManager } from '../../../services/github-account-manager.js';
import { getErrorMessage, logError } from '../common.js';

export function createGitHubAccountRoutes(githubAccountManager: GitHubAccountManager): Router {
  const router = Router();

  // GET / - Get all accounts with masked tokens
  router.get('/', async (_req: Request, res: Response): Promise<void> => {
    try {
      const accounts = await githubAccountManager.getAccounts();
      res.json({ success: true, accounts });
    } catch (error) {
      logError(error, 'Get GitHub accounts failed');
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  });

  // POST / - Add new account
  router.post('/', async (req: Request, res: Response): Promise<void> => {
    try {
      const { name, token } = req.body as {
        name?: string;
        token?: string;
      };

      if (!name) {
        res.status(400).json({ success: false, error: 'Name is required' });
        return;
      }

      if (!token) {
        res.status(400).json({ success: false, error: 'Token is required' });
        return;
      }

      // Validate token
      const validation = await githubAccountManager.validateToken(token);
      if (!validation.valid || !validation.username) {
        res.status(400).json({
          success: false,
          error: validation.error || 'Invalid GitHub token',
        });
        return;
      }

      const account = await githubAccountManager.addAccount(
        randomUUID(),
        name,
        token,
        validation.username
      );

      // Return account without raw token
      res.json({
        success: true,
        account: {
          ...account,
          token: undefined,
        },
      });
    } catch (error) {
      logError(error, 'Add GitHub account failed');
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  });

  // PUT /:id - Update account
  router.put('/:id', async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const updates = req.body as { name?: string; enabled?: boolean };

      const account = await githubAccountManager.updateAccount(id, updates);

      if (!account) {
        res.status(404).json({ success: false, error: 'Account not found' });
        return;
      }

      res.json({
        success: true,
        account: {
          ...account,
          token: undefined,
        },
      });
    } catch (error) {
      logError(error, 'Update GitHub account failed');
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  });

  // DELETE /:id - Delete account
  router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const deleted = await githubAccountManager.deleteAccount(id);

      if (!deleted) {
        res.status(404).json({ success: false, error: 'Account not found' });
        return;
      }

      res.json({ success: true });
    } catch (error) {
      logError(error, 'Delete GitHub account failed');
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  });

  // POST /capture-token - Capture token from local gh CLI auth
  router.post('/capture-token', async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await githubAccountManager.captureToken();

      if (result.error) {
        res.status(400).json({ success: false, error: result.error });
        return;
      }

      res.json({
        success: true,
        token: result.token,
        username: result.username,
      });
    } catch (error) {
      logError(error, 'Capture GitHub token failed');
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  });

  return router;
}
