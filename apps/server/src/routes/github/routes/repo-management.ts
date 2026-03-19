/**
 * GitHub repo management routes - Create repos, check repo status
 *
 * Endpoints:
 * - POST /create-repo  - Create a new GitHub repo for a project
 * - POST /repo-status   - Get repo status (remote info, GitHub connection)
 */

import type { Request, Response } from 'express';
import { execAsync, execEnv, getErrorMessage, logError } from './common.js';
import type { GitHubAccountManager } from '../../../services/github-account-manager.js';
import { checkGitHubRemote } from './check-github-remote.js';

/**
 * Build exec env with optional GH_TOKEN injection.
 */
function getExecEnvWithGhToken(token?: string) {
  if (!token) return execEnv;
  return { ...execEnv, GH_TOKEN: token };
}

export function createCreateRepoHandler(githubAccountManager: GitHubAccountManager) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { projectPath, repoName, visibility, githubAccountId } = req.body as {
        projectPath: string;
        repoName: string;
        visibility?: 'public' | 'private';
        githubAccountId?: string;
      };

      if (!projectPath) {
        res.status(400).json({ success: false, error: 'projectPath is required' });
        return;
      }

      if (!repoName) {
        res.status(400).json({ success: false, error: 'repoName is required' });
        return;
      }

      // Validate repo name
      if (!/^[a-zA-Z0-9._-]+$/.test(repoName)) {
        res.status(400).json({
          success: false,
          error:
            'Invalid repository name. Use only letters, numbers, hyphens, dots, and underscores.',
        });
        return;
      }

      // Resolve token
      let token: string | undefined;
      if (githubAccountId) {
        const settings = await githubAccountManager['settingsService'].getGlobalSettings();
        const account = (settings.githubAccounts ?? []).find(
          (a) => a.id === githubAccountId && a.enabled
        );
        token = account?.token;
      }
      if (!token) {
        token = await githubAccountManager.getTokenForProject(projectPath);
      }

      const env = getExecEnvWithGhToken(token);
      const vis = visibility || 'private';

      // Check if git is initialized
      try {
        await execAsync('git rev-parse --is-inside-work-tree', {
          cwd: projectPath,
          env,
        });
      } catch {
        // Initialize git if not already
        await execAsync('git init', { cwd: projectPath, env });
      }

      // Check if there are commits
      let hasCommits = false;
      try {
        await execAsync('git rev-parse --verify HEAD', { cwd: projectPath, env });
        hasCommits = true;
      } catch {
        // No commits yet
      }

      // Create initial commit if needed
      if (!hasCommits) {
        await execAsync('git add -A', { cwd: projectPath, env });
        try {
          await execAsync('git commit -m "Initial commit"', { cwd: projectPath, env });
        } catch {
          // May fail if nothing to commit - that's ok, create empty commit
          await execAsync('git commit --allow-empty -m "Initial commit"', {
            cwd: projectPath,
            env,
          });
        }
      }

      // Create the repo using gh CLI
      const cmd = `gh repo create "${repoName}" --${vis} --source=. --remote=origin --push`;
      const { stdout } = await execAsync(cmd, {
        cwd: projectPath,
        env,
      });

      const repoUrl = stdout.trim();

      res.json({
        success: true,
        result: {
          repoUrl,
          repoName,
          visibility: vis,
        },
      });
    } catch (error) {
      logError(error, 'Create GitHub repo failed');
      const message = getErrorMessage(error);
      // Provide better error messages for common failures
      if (message.includes('already exists')) {
        res.status(409).json({
          success: false,
          error: 'A repository with this name already exists on GitHub.',
        });
        return;
      }
      res.status(500).json({ success: false, error: message });
    }
  };
}

export function createRepoStatusHandler(githubAccountManager: GitHubAccountManager) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { projectPath, githubAccountId } = req.body as {
        projectPath: string;
        githubAccountId?: string;
      };

      if (!projectPath) {
        res.status(400).json({ success: false, error: 'projectPath is required' });
        return;
      }

      // Check if it's a git repo
      let isGitRepo = false;
      try {
        await execAsync('git rev-parse --is-inside-work-tree', { cwd: projectPath, env: execEnv });
        isGitRepo = true;
      } catch {
        // Not a git repo
      }

      if (!isGitRepo) {
        res.json({
          success: true,
          isGitRepo: false,
          hasGitHubRemote: false,
          remoteUrl: null,
          owner: null,
          repo: null,
        });
        return;
      }

      // Use the existing checkGitHubRemote function, but with token injection
      let token: string | undefined;
      if (githubAccountId) {
        const settings = await githubAccountManager['settingsService'].getGlobalSettings();
        const account = (settings.githubAccounts ?? []).find(
          (a) => a.id === githubAccountId && a.enabled
        );
        token = account?.token;
      }
      if (!token) {
        token = await githubAccountManager.getTokenForProject(projectPath);
      }

      // Get basic remote info first
      const status = await checkGitHubRemote(projectPath);

      // Get branch info
      let currentBranch: string | null = null;
      try {
        const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', {
          cwd: projectPath,
          env: execEnv,
        });
        currentBranch = stdout.trim();
      } catch {
        // No commits yet
      }

      // Get changed files count
      let changedFilesCount = 0;
      try {
        const { stdout: statusOutput } = await execAsync('git status --porcelain', {
          cwd: projectPath,
          env: execEnv,
        });
        changedFilesCount = statusOutput.trim() ? statusOutput.trim().split('\n').length : 0;
      } catch {
        // Ignore
      }

      // Get unpushed commits count
      let unpushedCommits = 0;
      try {
        const { stdout: logOutput } = await execAsync(
          'git log @{upstream}..HEAD --oneline 2>/dev/null || echo ""',
          { cwd: projectPath, env: execEnv }
        );
        const lines = logOutput.trim();
        unpushedCommits = lines ? lines.split('\n').length : 0;
      } catch {
        // No upstream tracking
      }

      res.json({
        success: true,
        isGitRepo: true,
        ...status,
        currentBranch,
        changedFilesCount,
        unpushedCommits,
      });
    } catch (error) {
      logError(error, 'Repo status failed');
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  };
}
