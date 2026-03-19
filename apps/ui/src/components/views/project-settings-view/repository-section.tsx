/**
 * RepositorySection - Project-level GitHub repository management
 *
 * Three sub-sections:
 * A. GitHub Account Selector - choose which GitHub account for this project
 * B. Repository Status - shows connection status, remote URL, etc.
 * C. Repository Actions - create repo, connect existing, commit & push
 */

import { useState, useEffect, useCallback } from 'react';
import { getHttpApiClient } from '@/lib/http-api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Github,
  GitBranch,
  ExternalLink,
  Plus,
  Link,
  Upload,
  RefreshCw,
  Settings,
  Check,
  AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Project as ElectronProject } from '@/lib/electron';

interface GitHubAccountOption {
  id: string;
  name: string;
  username: string;
  enabled: boolean;
  maskedToken: string;
}

interface RepoStatus {
  isGitRepo: boolean;
  hasGitHubRemote: boolean;
  remoteUrl: string | null;
  owner: string | null;
  repo: string | null;
  currentBranch: string | null;
  changedFilesCount: number;
  unpushedCommits: number;
}

interface RepositorySectionProps {
  project: ElectronProject;
}

export function RepositorySection({ project }: RepositorySectionProps) {
  const [accounts, setAccounts] = useState<GitHubAccountOption[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [repoStatus, setRepoStatus] = useState<RepoStatus | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showConnectDialog, setShowConnectDialog] = useState(false);

  // Create repo form
  const [repoName, setRepoName] = useState('');
  const [repoVisibility, setRepoVisibility] = useState<'public' | 'private'>('private');
  const [isCreating, setIsCreating] = useState(false);

  // Connect repo form
  const [remoteUrl, setRemoteUrl] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);

  // Commit & push
  const [commitMessage, setCommitMessage] = useState('');
  const [isCommitting, setIsCommitting] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isGeneratingMessage, setIsGeneratingMessage] = useState(false);

  const httpApi = getHttpApiClient();

  // Fetch GitHub accounts
  const fetchAccounts = useCallback(async () => {
    try {
      const response = await httpApi.get('/api/settings/github-accounts');
      if (response.success) {
        setAccounts(response.accounts);
      }
    } catch {
      // Silently ignore
    }
  }, []);

  // Fetch project settings to get selected account
  const fetchProjectSettings = useCallback(async () => {
    try {
      const response = await httpApi.post('/api/settings/project', {
        projectPath: project.path,
      });
      if (response.success && response.settings?.githubAccountId) {
        setSelectedAccountId(response.settings.githubAccountId);
      }
    } catch {
      // Silently ignore
    }
  }, [project.path]);

  // Fetch repo status
  const fetchRepoStatus = useCallback(async () => {
    setIsLoadingStatus(true);
    try {
      const response = await httpApi.post('/api/github/repo-status', {
        projectPath: project.path,
        githubAccountId: selectedAccountId || undefined,
      });
      if (response.success) {
        setRepoStatus({
          isGitRepo: response.isGitRepo,
          hasGitHubRemote: response.hasGitHubRemote,
          remoteUrl: response.remoteUrl,
          owner: response.owner,
          repo: response.repo,
          currentBranch: response.currentBranch,
          changedFilesCount: response.changedFilesCount ?? 0,
          unpushedCommits: response.unpushedCommits ?? 0,
        });
      }
    } catch {
      // Silently ignore
    } finally {
      setIsLoadingStatus(false);
    }
  }, [project.path, selectedAccountId]);

  useEffect(() => {
    fetchAccounts();
    fetchProjectSettings();
  }, [fetchAccounts, fetchProjectSettings]);

  useEffect(() => {
    fetchRepoStatus();
  }, [fetchRepoStatus]);

  // Save selected account to project settings
  const handleAccountChange = async (accountId: string) => {
    const value = accountId === 'none' ? '' : accountId;
    setSelectedAccountId(value);
    try {
      await httpApi.put('/api/settings/project', {
        projectPath: project.path,
        updates: { githubAccountId: value || undefined },
      });
      toast.success('GitHub account updated for this project');
      // Re-fetch repo status with new account
      setTimeout(fetchRepoStatus, 300);
    } catch {
      toast.error('Failed to save account selection');
    }
  };

  // Create new repo
  const handleCreateRepo = async () => {
    if (!repoName.trim()) {
      toast.error('Repository name is required');
      return;
    }

    setIsCreating(true);
    try {
      const response = await httpApi.post('/api/github/create-repo', {
        projectPath: project.path,
        repoName: repoName.trim(),
        visibility: repoVisibility,
        githubAccountId: selectedAccountId || undefined,
      });

      if (response.success) {
        toast.success(`Repository "${repoName}" created successfully`);
        setShowCreateDialog(false);
        setRepoName('');
        fetchRepoStatus();
      } else {
        toast.error(response.error || 'Failed to create repository');
      }
    } catch {
      toast.error('Failed to create repository');
    } finally {
      setIsCreating(false);
    }
  };

  // Connect to existing repo
  const handleConnectRepo = async () => {
    if (!remoteUrl.trim()) {
      toast.error('Remote URL is required');
      return;
    }

    setIsConnecting(true);
    try {
      const response = await httpApi.post('/api/worktree/add-remote', {
        worktreePath: project.path,
        remoteName: 'origin',
        remoteUrl: remoteUrl.trim(),
      });

      if (response.success) {
        toast.success('Remote added successfully');
        setShowConnectDialog(false);
        setRemoteUrl('');
        fetchRepoStatus();
      } else {
        toast.error(response.error || 'Failed to add remote');
      }
    } catch {
      toast.error('Failed to connect repository');
    } finally {
      setIsConnecting(false);
    }
  };

  // Generate commit message
  const handleGenerateCommitMessage = async () => {
    setIsGeneratingMessage(true);
    try {
      const response = await httpApi.post('/api/worktree/generate-commit-message', {
        worktreePath: project.path,
      });
      if (response.success && response.result?.message) {
        setCommitMessage(response.result.message);
      } else {
        toast.error('Failed to generate commit message');
      }
    } catch {
      toast.error('Failed to generate commit message');
    } finally {
      setIsGeneratingMessage(false);
    }
  };

  // Commit changes
  const handleCommit = async () => {
    if (!commitMessage.trim()) {
      toast.error('Commit message is required');
      return;
    }

    setIsCommitting(true);
    try {
      const response = await httpApi.post('/api/worktree/commit', {
        worktreePath: project.path,
        message: commitMessage.trim(),
      });

      if (response.success) {
        toast.success('Changes committed');
        setCommitMessage('');
        fetchRepoStatus();
      } else {
        toast.error(response.error || 'Failed to commit');
      }
    } catch {
      toast.error('Failed to commit changes');
    } finally {
      setIsCommitting(false);
    }
  };

  // Push changes
  const handlePush = async () => {
    setIsPushing(true);
    try {
      const response = await httpApi.post('/api/worktree/push', {
        worktreePath: project.path,
      });

      if (response.success) {
        toast.success('Changes pushed successfully');
        fetchRepoStatus();
      } else {
        toast.error(response.error || 'Failed to push');
      }
    } catch {
      toast.error('Failed to push changes');
    } finally {
      setIsPushing(false);
    }
  };

  const enabledAccounts = accounts.filter((a) => a.enabled);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Github className="w-5 h-5" />
          Repository
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Manage the GitHub repository for this project.
        </p>
      </div>

      {/* A. GitHub Account Selector */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium">GitHub Account</h3>
        {enabledAccounts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-4 text-center">
            <p className="text-sm text-muted-foreground">
              No GitHub accounts configured.{' '}
              <button
                className="text-primary hover:underline"
                onClick={() => {
                  // Navigate to global settings github tab
                  toast.info('Add GitHub accounts in Settings > Account & Security > GitHub');
                }}
              >
                Add one in Settings
              </button>
            </p>
          </div>
        ) : (
          <Select value={selectedAccountId || 'none'} onValueChange={handleAccountChange}>
            <SelectTrigger className="w-full max-w-sm">
              <SelectValue placeholder="Select a GitHub account" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None (use default)</SelectItem>
              {enabledAccounts.map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  {account.name} (@{account.username})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* B. Repository Status */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Repository Status</h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchRepoStatus}
            disabled={isLoadingStatus}
            className="gap-1.5 h-7"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingStatus ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {repoStatus ? (
          <div className="rounded-lg border border-border p-4 space-y-3">
            <div className="flex items-center gap-2">
              {repoStatus.isGitRepo ? (
                <Check className="w-4 h-4 text-green-500" />
              ) : (
                <AlertCircle className="w-4 h-4 text-yellow-500" />
              )}
              <span className="text-sm">
                {repoStatus.isGitRepo ? 'Git repository initialized' : 'Not a git repository'}
              </span>
            </div>

            {repoStatus.isGitRepo && (
              <>
                <div className="flex items-center gap-2">
                  {repoStatus.hasGitHubRemote ? (
                    <Check className="w-4 h-4 text-green-500" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-yellow-500" />
                  )}
                  <span className="text-sm">
                    {repoStatus.hasGitHubRemote
                      ? 'Connected to GitHub'
                      : 'No GitHub remote configured'}
                  </span>
                </div>

                {repoStatus.remoteUrl && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Link className="w-3.5 h-3.5" />
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                      {repoStatus.remoteUrl}
                    </code>
                    {repoStatus.owner && repoStatus.repo && (
                      <a
                        href={`https://github.com/${repoStatus.owner}/${repoStatus.repo}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline inline-flex items-center gap-1"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                )}

                {repoStatus.currentBranch && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <GitBranch className="w-3.5 h-3.5" />
                    <span>{repoStatus.currentBranch}</span>
                  </div>
                )}

                <div className="flex gap-4 text-xs text-muted-foreground">
                  {repoStatus.changedFilesCount > 0 && (
                    <Badge variant="secondary">
                      {repoStatus.changedFilesCount} changed file
                      {repoStatus.changedFilesCount !== 1 ? 's' : ''}
                    </Badge>
                  )}
                  {repoStatus.unpushedCommits > 0 && (
                    <Badge variant="secondary">
                      {repoStatus.unpushedCommits} unpushed commit
                      {repoStatus.unpushedCommits !== 1 ? 's' : ''}
                    </Badge>
                  )}
                </div>
              </>
            )}
          </div>
        ) : isLoadingStatus ? (
          <div className="text-sm text-muted-foreground py-2">Loading...</div>
        ) : null}
      </div>

      {/* C. Repository Actions */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium">Actions</h3>

        <div className="flex flex-wrap gap-2">
          {/* Create or Connect */}
          {!repoStatus?.hasGitHubRemote && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setRepoName(project.name.toLowerCase().replace(/\s+/g, '-'));
                  setShowCreateDialog(true);
                }}
                className="gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                Create New Repo
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowConnectDialog(true)}
                className="gap-1.5"
              >
                <Link className="w-3.5 h-3.5" />
                Connect Existing Repo
              </Button>
            </>
          )}

          {/* Push */}
          {repoStatus?.hasGitHubRemote && (
            <Button
              variant="outline"
              size="sm"
              onClick={handlePush}
              disabled={isPushing}
              className="gap-1.5"
            >
              <Upload className="w-3.5 h-3.5" />
              {isPushing ? 'Pushing...' : 'Push'}
            </Button>
          )}
        </div>

        {/* Commit Section - only show if there are changed files */}
        {repoStatus?.isGitRepo && repoStatus.changedFilesCount > 0 && (
          <div className="rounded-lg border border-border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium">
                Commit Changes ({repoStatus.changedFilesCount} file
                {repoStatus.changedFilesCount !== 1 ? 's' : ''})
              </h4>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleGenerateCommitMessage}
                disabled={isGeneratingMessage}
                className="gap-1.5 h-7 text-xs"
              >
                <Settings className="w-3 h-3" />
                {isGeneratingMessage ? 'Generating...' : 'AI Generate'}
              </Button>
            </div>
            <Textarea
              placeholder="Commit message..."
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              className="min-h-[60px] text-sm"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleCommit}
                disabled={isCommitting || !commitMessage.trim()}
                className="gap-1.5"
              >
                <Check className="w-3.5 h-3.5" />
                {isCommitting ? 'Committing...' : 'Commit'}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Create Repo Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create GitHub Repository</DialogTitle>
            <DialogDescription>
              Create a new GitHub repository and push your project code.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="repo-name">Repository Name</Label>
              <Input
                id="repo-name"
                placeholder="my-project"
                value={repoName}
                onChange={(e) => setRepoName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Visibility</Label>
              <Select
                value={repoVisibility}
                onValueChange={(v) => setRepoVisibility(v as 'public' | 'private')}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="private">Private</SelectItem>
                  <SelectItem value="public">Public</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {selectedAccountId && (
              <p className="text-xs text-muted-foreground">
                Using account: {accounts.find((a) => a.id === selectedAccountId)?.name || 'Unknown'}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateRepo} disabled={isCreating || !repoName.trim()}>
              {isCreating ? 'Creating...' : 'Create Repository'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Connect Repo Dialog */}
      <Dialog open={showConnectDialog} onOpenChange={setShowConnectDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Connect Existing Repository</DialogTitle>
            <DialogDescription>
              Add a remote URL to connect to an existing GitHub repository.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="remote-url">Remote URL</Label>
              <Input
                id="remote-url"
                placeholder="https://github.com/user/repo.git"
                value={remoteUrl}
                onChange={(e) => setRemoteUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Use HTTPS or SSH format (e.g., git@github.com:user/repo.git)
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConnectDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleConnectRepo} disabled={isConnecting || !remoteUrl.trim()}>
              {isConnecting ? 'Connecting...' : 'Connect'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
