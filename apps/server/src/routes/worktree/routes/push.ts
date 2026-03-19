/**
 * POST /push endpoint - Push a worktree branch to remote
 *
 * Note: Git repository validation (isGitRepo, hasCommits) is handled by
 * the requireValidWorktree middleware in index.ts
 */

import type { Request, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getErrorMessage, logError } from '../common.js';
import type { GitHubAccountManager } from '../../../services/github-account-manager.js';
import { getExecEnvWithGhToken } from '../../github/routes/common.js';

const execAsync = promisify(exec);
const MAX_BUFFER = 10 * 1024 * 1024; // 10MB

export function createPushHandler(githubAccountManager?: GitHubAccountManager) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { worktreePath, projectPath, force, remote } = req.body as {
        worktreePath: string;
        projectPath?: string;
        force?: boolean;
        remote?: string;
      };

      if (!worktreePath) {
        res.status(400).json({
          success: false,
          error: 'worktreePath required',
        });
        return;
      }

      // Resolve GH_TOKEN for the project's configured GitHub account
      const effectiveProjectPath = projectPath || worktreePath;
      let ghToken: string | undefined;
      if (githubAccountManager) {
        ghToken = await githubAccountManager.getTokenForProject(effectiveProjectPath);
      }
      const env = getExecEnvWithGhToken(ghToken);

      // Get branch name
      const { stdout: branchOutput } = await execAsync('git rev-parse --abbrev-ref HEAD', {
        cwd: worktreePath,
        env,
      });
      const branchName = branchOutput.trim();

      // Use specified remote or default to 'origin'
      const targetRemote = remote || 'origin';

      // Push the branch
      const forceFlag = force ? '--force' : '';
      await execAsync(`git push -u ${targetRemote} ${branchName} ${forceFlag}`, {
        cwd: worktreePath,
        env,
        maxBuffer: MAX_BUFFER,
      });

      res.json({
        success: true,
        result: {
          branch: branchName,
          pushed: true,
          message: `Successfully pushed ${branchName} to ${targetRemote}`,
        },
      });
    } catch (error) {
      logError(error, 'Push worktree failed');
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  };
}
