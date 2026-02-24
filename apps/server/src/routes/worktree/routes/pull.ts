/**
 * POST /pull endpoint - Pull latest changes for a worktree/branch
 *
 * Note: Git repository validation (isGitRepo, hasCommits) is handled by
 * the requireValidWorktree middleware in index.ts
 */

import type { Request, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getErrorMessage, logError } from '../common.js';

const execAsync = promisify(exec);

export function createPullHandler() {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { worktreePath } = req.body as {
        worktreePath: string;
      };

      if (!worktreePath) {
        res.status(400).json({
          success: false,
          error: 'worktreePath required',
        });
        return;
      }

      // Get current branch name
      const { stdout: branchOutput } = await execAsync('git rev-parse --abbrev-ref HEAD', {
        cwd: worktreePath,
      });
      const branchName = branchOutput.trim();

      // Fetch latest from remote
      await execAsync('git fetch origin', { cwd: worktreePath });

      // Check if there are tracked file changes that would conflict with pull
      // Use -uno to ignore untracked files (they don't conflict with git pull)
      const { stdout: status } = await execAsync('git status --porcelain -uno', {
        cwd: worktreePath,
      });
      // Filter out .automaker/ changes (internal metadata, not user code)
      const conflictingChanges = status
        .trim()
        .split('\n')
        .filter((line) => line.trim() && !line.includes('.automaker/'));
      const hasLocalChanges = conflictingChanges.length > 0;

      if (hasLocalChanges) {
        res.status(400).json({
          success: false,
          error: 'You have local changes. Please commit them before pulling.',
        });
        return;
      }

      // Stash .automaker/ changes if any so they don't block git pull
      const hasAutomakerChanges = status
        .trim()
        .split('\n')
        .some((line) => line.trim() && line.includes('.automaker/'));
      if (hasAutomakerChanges) {
        await execAsync('git stash push -m "automaker-pull-stash" -- .automaker/', {
          cwd: worktreePath,
        });
      }

      // Pull latest changes
      try {
        const { stdout: pullOutput } = await execAsync(`git pull origin ${branchName}`, {
          cwd: worktreePath,
        });

        // Restore stashed .automaker/ changes
        if (hasAutomakerChanges) {
          await execAsync('git stash pop', { cwd: worktreePath }).catch(() => {});
        }

        // Check if we pulled any changes
        const alreadyUpToDate = pullOutput.includes('Already up to date');

        res.json({
          success: true,
          result: {
            branch: branchName,
            pulled: !alreadyUpToDate,
            message: alreadyUpToDate ? 'Already up to date' : 'Pulled latest changes',
          },
        });
      } catch (pullError: unknown) {
        // Restore stashed .automaker/ changes even on failure
        if (hasAutomakerChanges) {
          await execAsync('git stash pop', { cwd: worktreePath }).catch(() => {});
        }
        const err = pullError as { stderr?: string; message?: string };
        const errorMsg = err.stderr || err.message || 'Pull failed';

        // Check for common errors
        if (errorMsg.includes('no tracking information')) {
          res.status(400).json({
            success: false,
            error: `Branch '${branchName}' has no upstream branch. Push it first or set upstream with: git branch --set-upstream-to=origin/${branchName}`,
          });
          return;
        }

        res.status(500).json({
          success: false,
          error: errorMsg,
        });
      }
    } catch (error) {
      logError(error, 'Pull failed');
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  };
}
