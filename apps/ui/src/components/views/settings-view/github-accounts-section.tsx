/**
 * GitHubAccountsSection - Manage GitHub accounts for per-project token injection
 *
 * Allows users to add, edit, toggle, and remove GitHub accounts.
 * Accounts store a PAT or token from `gh auth login` that gets injected
 * as GH_TOKEN for gh CLI operations.
 */

import { useState, useEffect, useCallback } from 'react';
import { getHttpApiClient } from '@/lib/http-api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { Github, KeyRound, MoreVertical, Pencil, Plus, Terminal, Trash2, User } from 'lucide-react';
import { toast } from 'sonner';
import type { GitHubAccount } from '@automaker/types';

/** Account as returned from the server (token masked) */
interface AccountDisplay extends Omit<GitHubAccount, 'token'> {
  token: string;
  maskedToken: string;
}

type AddMode = 'token' | 'cli';

export function GitHubAccountsSection() {
  const [accounts, setAccounts] = useState<AccountDisplay[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addMode, setAddMode] = useState<AddMode>('token');
  const [editingAccount, setEditingAccount] = useState<AccountDisplay | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formToken, setFormToken] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);

  const httpApi = getHttpApiClient();

  const fetchAccounts = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await httpApi.get('/api/settings/github-accounts');
      if (response.success) {
        setAccounts(response.accounts);
      }
    } catch {
      // Endpoint may not exist yet
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  const resetForm = () => {
    setFormName('');
    setFormToken('');
    setAddMode('token');
    setIsCapturing(false);
  };

  const handleAddAccount = async () => {
    if (!formName.trim()) {
      toast.error('Account name is required');
      return;
    }
    if (!formToken.trim()) {
      toast.error('Token is required');
      return;
    }

    setIsSaving(true);
    try {
      const response = await httpApi.post('/api/settings/github-accounts', {
        name: formName.trim(),
        token: formToken.trim(),
      });

      if (response.success) {
        toast.success(`GitHub account "${formName}" added`);
        setShowAddDialog(false);
        resetForm();
        fetchAccounts();
      } else {
        toast.error(response.error || 'Failed to add account');
      }
    } catch (error) {
      toast.error('Failed to add account');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCaptureToken = async () => {
    setIsCapturing(true);
    try {
      const response = await httpApi.post('/api/settings/github-accounts/capture-token', {});

      if (response.success && response.token) {
        setFormToken(response.token);
        toast.success(`Captured token for ${response.username}`);
      } else {
        toast.error(response.error || 'Failed to capture token. Run `gh auth login` first.');
      }
    } catch {
      toast.error('Failed to capture token from gh CLI');
    } finally {
      setIsCapturing(false);
    }
  };

  const handleUpdateAccount = async () => {
    if (!editingAccount) return;

    setIsSaving(true);
    try {
      const response = await httpApi.put(`/api/settings/github-accounts/${editingAccount.id}`, {
        name: formName.trim(),
      });

      if (response.success) {
        toast.success(`Account "${formName}" updated`);
        setEditingAccount(null);
        resetForm();
        fetchAccounts();
      } else {
        toast.error(response.error || 'Failed to update account');
      }
    } catch {
      toast.error('Failed to update account');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteAccount = async (account: AccountDisplay) => {
    try {
      const response = await httpApi.delete(`/api/settings/github-accounts/${account.id}`);
      if (response.success) {
        toast.success(`Account "${account.name}" deleted`);
        fetchAccounts();
      } else {
        toast.error(response.error || 'Failed to delete account');
      }
    } catch {
      toast.error('Failed to delete account');
    }
  };

  const handleToggleEnabled = async (account: AccountDisplay) => {
    try {
      await httpApi.put(`/api/settings/github-accounts/${account.id}`, {
        enabled: !account.enabled,
      });
      fetchAccounts();
    } catch {
      toast.error('Failed to update account');
    }
  };

  const openEditDialog = (account: AccountDisplay) => {
    setEditingAccount(account);
    setFormName(account.name);
    setFormToken('');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Github className="w-5 h-5" />
          GitHub Accounts
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Manage GitHub accounts for repository operations. Each account's token is injected as
          GH_TOKEN when running gh CLI commands. Select which account to use per-project in Project
          Settings.
        </p>
      </div>

      {/* Account List */}
      <div className="space-y-2">
        {isLoading && accounts.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4 text-center">Loading accounts...</div>
        ) : accounts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center">
            <Github className="w-8 h-8 mx-auto text-muted-foreground/50 mb-2" />
            <p className="text-sm text-muted-foreground">No GitHub accounts configured</p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Add an account to enable repository creation, PR management, and more.
            </p>
          </div>
        ) : (
          accounts.map((account) => (
            <div
              key={account.id}
              className={cn(
                'flex items-center gap-3 rounded-lg border p-3 transition-colors',
                account.enabled
                  ? 'border-border bg-card'
                  : 'border-border/50 bg-muted/30 opacity-60'
              )}
            >
              <div className="flex-shrink-0">
                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                  <User className="w-4 h-4 text-muted-foreground" />
                </div>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm truncate">{account.name}</span>
                  <Badge variant="outline" className="text-xs">
                    @{account.username}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 font-mono">
                  {account.maskedToken}
                </div>
              </div>

              <Switch
                checked={account.enabled}
                onCheckedChange={() => handleToggleEnabled(account)}
              />

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                    <MoreVertical className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => openEditDialog(account)}>
                    <Pencil className="w-4 h-4 mr-2" />
                    Edit Name
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => handleDeleteAccount(account)}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))
        )}
      </div>

      {/* Add Account Button */}
      <Button onClick={() => setShowAddDialog(true)} className="gap-2">
        <Plus className="w-4 h-4" />
        Add GitHub Account
      </Button>

      {/* Add Account Dialog */}
      <Dialog
        open={showAddDialog}
        onOpenChange={(open) => {
          setShowAddDialog(open);
          if (!open) resetForm();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add GitHub Account</DialogTitle>
            <DialogDescription>
              Add a GitHub account by entering a Personal Access Token or capturing one from the gh
              CLI.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Mode Toggle */}
            <div className="flex gap-2">
              <Button
                variant={addMode === 'token' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setAddMode('token')}
                className="gap-1.5"
              >
                <KeyRound className="w-3.5 h-3.5" />
                Enter Token
              </Button>
              <Button
                variant={addMode === 'cli' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setAddMode('cli')}
                className="gap-1.5"
              >
                <Terminal className="w-3.5 h-3.5" />
                From gh CLI
              </Button>
            </div>

            {/* Account Name */}
            <div className="space-y-2">
              <Label htmlFor="github-name">Account Name</Label>
              <Input
                id="github-name"
                placeholder="e.g., Personal, Work"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </div>

            {addMode === 'token' ? (
              <div className="space-y-2">
                <Label htmlFor="github-token">Personal Access Token</Label>
                <Input
                  id="github-token"
                  type="password"
                  placeholder="ghp_... or github_pat_..."
                  value={formToken}
                  onChange={(e) => setFormToken(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Create a token at GitHub Settings &gt; Developer Settings &gt; Personal Access
                  Tokens with repo scope.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Capture from gh CLI</Label>
                <p className="text-xs text-muted-foreground">
                  First run <code className="px-1 py-0.5 bg-muted rounded">gh auth login</code> in a
                  terminal, then click capture to extract the token.
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={handleCaptureToken}
                    disabled={isCapturing}
                    className="gap-1.5"
                  >
                    {isCapturing ? 'Capturing...' : 'Capture Token'}
                  </Button>
                  {formToken && (
                    <Badge variant="secondary" className="self-center">
                      Token captured
                    </Badge>
                  )}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddAccount} disabled={isSaving || !formName || !formToken}>
              {isSaving ? 'Adding...' : 'Add Account'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Account Dialog */}
      <Dialog
        open={!!editingAccount}
        onOpenChange={(open) => {
          if (!open) {
            setEditingAccount(null);
            resetForm();
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit GitHub Account</DialogTitle>
            <DialogDescription>Update the account display name.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-github-name">Account Name</Label>
              <Input
                id="edit-github-name"
                placeholder="e.g., Personal, Work"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingAccount(null)}>
              Cancel
            </Button>
            <Button onClick={handleUpdateAccount} disabled={isSaving || !formName}>
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
