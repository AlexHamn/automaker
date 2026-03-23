/**
 * POST /clone endpoint - Clone a GitHub template to a new project directory
 *
 * Tries cloning with each configured GitHub account's token when the initial
 * clone fails (e.g., private repos). This allows cloning from any account
 * the user has configured, not just the default GH_TOKEN.
 */

import type { Request, Response } from 'express';
import { spawn } from 'child_process';
import path from 'path';
import * as secureFs from '../../../lib/secure-fs.js';
import { PathNotAllowedError } from '@automaker/platform';
import { logger, getErrorMessage, logError } from '../common.js';
import type { GitHubAccountManager } from '../../../services/github-account-manager.js';

/**
 * Attempt to clone a repo, optionally injecting a token into the URL for private repos.
 */
function cloneRepo(
  repoUrl: string,
  projectPath: string,
  parentDir: string,
  token?: string
): Promise<{ success: boolean; error?: string }> {
  // If token provided, inject it into the HTTPS URL for authentication
  const cloneUrl =
    token && repoUrl.startsWith('https://github.com/')
      ? repoUrl.replace('https://github.com/', `https://x-access-token:${token}@github.com/`)
      : repoUrl;

  return new Promise((resolve) => {
    const gitProcess = spawn('git', ['clone', cloneUrl, projectPath], {
      cwd: parentDir,
    });

    let stderr = '';

    gitProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    gitProcess.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true });
      } else {
        resolve({
          success: false,
          error: stderr || `Git clone failed with code ${code}`,
        });
      }
    });

    gitProcess.on('error', (error) => {
      resolve({
        success: false,
        error: `Failed to spawn git: ${error.message}`,
      });
    });
  });
}

export function createCloneHandler(githubAccountManager?: GitHubAccountManager) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { repoUrl, projectName, parentDir } = req.body as {
        repoUrl: string;
        projectName: string;
        parentDir: string;
      };

      // Validate inputs
      if (!repoUrl || !projectName || !parentDir) {
        res.status(400).json({
          success: false,
          error: 'repoUrl, projectName, and parentDir are required',
        });
        return;
      }

      logger.info(
        `[Templates] Clone request - Repo: ${repoUrl}, Project: ${projectName}, Parent: ${parentDir}`
      );

      // Validate repo URL is a valid GitHub URL
      const githubUrlPattern = /^https:\/\/github\.com\/[\w-]+\/[\w.-]+$/;
      if (!githubUrlPattern.test(repoUrl)) {
        res.status(400).json({
          success: false,
          error: 'Invalid GitHub repository URL',
        });
        return;
      }

      // Sanitize project name (allow alphanumeric, dash, underscore)
      const sanitizedName = projectName.replace(/[^a-zA-Z0-9-_]/g, '-');
      if (sanitizedName !== projectName) {
        logger.info(`[Templates] Sanitized project name: ${projectName} -> ${sanitizedName}`);
      }

      // Build full project path
      const projectPath = path.join(parentDir, sanitizedName);

      const resolvedParent = path.resolve(parentDir);
      const resolvedProject = path.resolve(projectPath);
      const relativePath = path.relative(resolvedParent, resolvedProject);
      if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        res.status(400).json({
          success: false,
          error: 'Invalid project name; potential path traversal attempt.',
        });
        return;
      }

      // Check if directory already exists (secureFs.access also validates path is allowed)
      try {
        await secureFs.access(projectPath);
        res.status(400).json({
          success: false,
          error: `Directory "${sanitizedName}" already exists in ${parentDir}`,
        });
        return;
      } catch (accessError) {
        if (accessError instanceof PathNotAllowedError) {
          res.status(403).json({
            success: false,
            error: `Project path not allowed: ${projectPath}. Must be within ALLOWED_ROOT_DIRECTORY.`,
          });
          return;
        }
        // Directory doesn't exist, which is what we want
      }

      // Ensure parent directory exists
      try {
        // Check if parentDir is a root path (Windows: C:\, D:\, etc. or Unix: /)
        const isWindowsRoot = /^[A-Za-z]:\\?$/.test(parentDir);
        const isUnixRoot = parentDir === '/' || parentDir === '';
        const isRoot = isWindowsRoot || isUnixRoot;

        if (isRoot) {
          // Root paths always exist, just verify access
          logger.info(`[Templates] Using root path: ${parentDir}`);
          await secureFs.access(parentDir);
        } else {
          // Check if parent directory exists
          let parentExists = false;
          try {
            await secureFs.access(parentDir);
            parentExists = true;
          } catch {
            parentExists = false;
          }

          if (!parentExists) {
            logger.info(`[Templates] Creating parent directory: ${parentDir}`);
            await secureFs.mkdir(parentDir, { recursive: true });
          } else {
            logger.info(`[Templates] Parent directory exists: ${parentDir}`);
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('[Templates] Failed to access parent directory:', parentDir, error);
        res.status(500).json({
          success: false,
          error: `Failed to access parent directory: ${errorMessage}`,
        });
        return;
      }

      logger.info(`[Templates] Cloning ${repoUrl} to ${projectPath}`);

      // Try cloning — first without token (public repos), then with each configured account
      let cloneResult = await cloneRepo(repoUrl, projectPath, parentDir);

      if (!cloneResult.success && githubAccountManager) {
        // Clone failed — likely a private repo. Try each GitHub account.
        logger.info('[Templates] Initial clone failed, trying configured GitHub accounts...');

        const accounts = await githubAccountManager.getAccountsWithTokens();

        for (const account of accounts) {
          if (!account.enabled || !account.token) continue;

          logger.info(`[Templates] Trying account: ${account.username || account.name}`);

          // Clean up failed clone directory before retrying
          try {
            await secureFs.rm(projectPath, { recursive: true, force: true });
          } catch {
            // May not exist yet
          }

          cloneResult = await cloneRepo(repoUrl, projectPath, parentDir, account.token);

          if (cloneResult.success) {
            logger.info(
              `[Templates] Clone succeeded with account: ${account.username || account.name}`
            );
            break;
          }
        }
      }

      if (!cloneResult.success) {
        // Clean up any partial clone
        try {
          await secureFs.rm(projectPath, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }

        res.status(500).json({
          success: false,
          error: cloneResult.error || 'Failed to clone repository',
        });
        return;
      }

      // Remove .git directory to start fresh
      try {
        const gitDir = path.join(projectPath, '.git');
        await secureFs.rm(gitDir, { recursive: true, force: true });
        logger.info('[Templates] Removed .git directory');
      } catch (error) {
        logger.warn('[Templates] Could not remove .git directory:', error);
        // Continue anyway - not critical
      }

      // Initialize a fresh git repository
      await new Promise<void>((resolve) => {
        const gitInit = spawn('git', ['init'], {
          cwd: projectPath,
        });

        gitInit.on('close', () => {
          logger.info('[Templates] Initialized fresh git repository');
          resolve();
        });

        gitInit.on('error', () => {
          logger.warn('[Templates] Could not initialize git');
          resolve();
        });
      });

      logger.info(`[Templates] Successfully cloned template to ${projectPath}`);

      res.json({
        success: true,
        projectPath,
        projectName: sanitizedName,
      });
    } catch (error) {
      logError(error, 'Clone template failed');
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  };
}
