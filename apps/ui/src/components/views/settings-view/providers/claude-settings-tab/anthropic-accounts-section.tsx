/**
 * AnthropicAccountsSection - Multi-account management UI with API key and OAuth support
 *
 * Allows users to add, edit, reorder, and remove multiple Anthropic accounts
 * for automatic rate-limit failover. Supports both API key accounts and
 * Claude Code OAuth accounts (Pro/Max subscriptions via `claude login`).
 *
 * OAuth accounts accept a JSON paste of the full ~/.claude/.credentials.json file
 * (or just the inner claudeAiOauth object). The server creates per-account HOME
 * directories so the SDK subprocess authenticates via standard credential resolution.
 */

import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '@/store/app-store';
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
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  MoreVertical,
  Pencil,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
  User,
} from 'lucide-react';
import { toast } from 'sonner';
import type {
  AnthropicAccount,
  AnthropicAuthType,
  AccountFailoverSettings,
  ClaudeOAuthCredentials,
} from '@automaker/types';

/** Account with computed status from the server */
interface AccountWithStatus extends AnthropicAccount {
  isRateLimited: boolean;
  resetTimeString?: string;
}

/**
 * Try to parse a credentials JSON string into ClaudeOAuthCredentials.
 * Accepts both the raw file format ({ claudeAiOauth: {...} }) and the inner object.
 */
function parseCredentialsJson(
  text: string
):
  | { credentials: ClaudeOAuthCredentials; error?: undefined }
  | { credentials?: undefined; error: string } {
  if (!text.trim()) {
    return { error: 'Paste the contents of ~/.claude/.credentials.json' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    return { error: 'Invalid JSON' };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { error: 'Expected a JSON object' };
  }

  // Accept raw file format: { claudeAiOauth: { accessToken, refreshToken, ... } }
  const obj = parsed as Record<string, unknown>;
  let inner: Record<string, unknown>;

  if (obj.claudeAiOauth && typeof obj.claudeAiOauth === 'object') {
    inner = obj.claudeAiOauth as Record<string, unknown>;
  } else if (obj.accessToken && obj.refreshToken) {
    // Direct inner object
    inner = obj;
  } else {
    return {
      error:
        'Expected { claudeAiOauth: { accessToken, refreshToken, ... } } or { accessToken, refreshToken, ... }',
    };
  }

  // Validate required fields
  if (!inner.accessToken || typeof inner.accessToken !== 'string') {
    return { error: 'Missing accessToken' };
  }
  if (!inner.refreshToken || typeof inner.refreshToken !== 'string') {
    return { error: 'Missing refreshToken' };
  }
  if (typeof inner.expiresAt !== 'number') {
    return { error: 'Missing or invalid expiresAt' };
  }
  if (!(inner.accessToken as string).startsWith('sk-ant-oat')) {
    return { error: 'accessToken should start with sk-ant-oat...' };
  }
  if (!(inner.refreshToken as string).startsWith('sk-ant-ort')) {
    return { error: 'refreshToken should start with sk-ant-ort...' };
  }

  return {
    credentials: {
      accessToken: inner.accessToken as string,
      refreshToken: inner.refreshToken as string,
      expiresAt: inner.expiresAt as number,
      ...(Array.isArray(inner.scopes) && { scopes: inner.scopes as string[] }),
      ...(typeof inner.subscriptionType === 'string' && {
        subscriptionType: inner.subscriptionType,
      }),
      ...(typeof inner.rateLimitTier === 'string' && { rateLimitTier: inner.rateLimitTier }),
    },
  };
}

export function AnthropicAccountsSection() {
  const {
    anthropicAccounts,
    accountFailoverSettings,
    setAnthropicAccounts,
    setAccountFailoverSettings,
  } = useAppStore();

  const [accounts, setAccounts] = useState<AccountWithStatus[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingAccount, setEditingAccount] = useState<AccountWithStatus | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formAuthType, setFormAuthType] = useState<AnthropicAuthType>('api-key');
  const [formApiKey, setFormApiKey] = useState('');
  const [formCredentialsJson, setFormCredentialsJson] = useState('');
  const [parsedCredentials, setParsedCredentials] = useState<ClaudeOAuthCredentials | null>(null);
  const [credentialsParseError, setCredentialsParseError] = useState('');
  const [showCredential, setShowCredential] = useState(false);
  const [formError, setFormError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const httpApi = getHttpApiClient();

  // Parse credentials JSON on change
  useEffect(() => {
    if (!formCredentialsJson.trim()) {
      setParsedCredentials(null);
      setCredentialsParseError('');
      return;
    }
    const result = parseCredentialsJson(formCredentialsJson);
    if (result.credentials) {
      setParsedCredentials(result.credentials);
      setCredentialsParseError('');
    } else {
      setParsedCredentials(null);
      setCredentialsParseError(result.error);
    }
  }, [formCredentialsJson]);

  // Fetch accounts with status from server
  const fetchAccounts = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await httpApi.get('/api/settings/accounts');
      if (response.success) {
        setAccounts(response.accounts);
      }
    } catch {
      // Accounts endpoint may not exist yet — silently ignore
    } finally {
      setIsLoading(false);
    }
  }, [httpApi]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  // Subscribe to account events via WebSocket
  useEffect(() => {
    const unsub1 = httpApi.accounts.onRateLimited((payload) => {
      toast.warning(`Account "${payload.accountName}" hit rate limit`, {
        description: `Resets ${payload.resetTimeString || 'soon'}`,
      });
      fetchAccounts();
    });

    const unsub2 = httpApi.accounts.onFailover((payload) => {
      toast.info(`Switched to account "${payload.toAccountName}"`, {
        description: 'Automatic failover due to rate limit',
      });
      fetchAccounts();
    });

    return () => {
      unsub1();
      unsub2();
    };
  }, [httpApi, fetchAccounts]);

  const handleAddAccount = async () => {
    if (!formName.trim()) {
      setFormError('Name is required');
      return;
    }

    if (formAuthType === 'oauth') {
      if (!parsedCredentials) {
        setFormError(credentialsParseError || 'Valid credentials JSON is required');
        return;
      }
    } else if (!formApiKey.trim()) {
      setFormError('API key is required');
      return;
    }

    setIsSaving(true);
    setFormError('');

    try {
      const body: Record<string, unknown> = {
        name: formName.trim(),
        authType: formAuthType,
      };
      if (formAuthType === 'oauth') {
        body.oauthCredentials = parsedCredentials;
      } else {
        body.apiKey = formApiKey.trim();
      }

      const response = await httpApi.post('/api/settings/accounts', body);

      if (response.success) {
        toast.success(`Account "${formName}" added`);
        setShowAddDialog(false);
        resetForm();
        fetchAccounts();
        // Sync to store
        const settingsResp = await httpApi.get('/api/settings/global');
        if (settingsResp.success) {
          setAnthropicAccounts(settingsResp.settings.anthropicAccounts ?? []);
        }
      } else {
        setFormError(response.error || 'Failed to add account');
      }
    } catch (error: any) {
      setFormError(error?.message || 'Failed to add account');
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateAccount = async () => {
    if (!editingAccount) return;

    setIsSaving(true);
    setFormError('');

    try {
      const updates: Record<string, any> = { name: formName.trim() };

      if (editingAccount.authType === 'oauth') {
        if (parsedCredentials) {
          updates.oauthCredentials = parsedCredentials;
        }
      } else {
        if (formApiKey.trim() && !formApiKey.includes('...')) {
          updates.apiKey = formApiKey.trim();
        }
      }

      const response = await httpApi.put(`/api/settings/accounts/${editingAccount.id}`, updates);

      if (response.success) {
        toast.success(`Account "${formName}" updated`);
        setEditingAccount(null);
        resetForm();
        fetchAccounts();
        const settingsResp = await httpApi.get('/api/settings/global');
        if (settingsResp.success) {
          setAnthropicAccounts(settingsResp.settings.anthropicAccounts ?? []);
        }
      } else {
        setFormError(response.error || 'Failed to update account');
      }
    } catch (error: any) {
      setFormError(error?.message || 'Failed to update account');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteAccount = async (account: AccountWithStatus) => {
    try {
      const response = await httpApi.delete(`/api/settings/accounts/${account.id}`);
      if (response.success) {
        toast.success(`Account "${account.name}" deleted`);
        fetchAccounts();
        const settingsResp = await httpApi.get('/api/settings/global');
        if (settingsResp.success) {
          setAnthropicAccounts(settingsResp.settings.anthropicAccounts ?? []);
        }
      }
    } catch {
      toast.error('Failed to delete account');
    }
  };

  const handleToggleEnabled = async (account: AccountWithStatus) => {
    try {
      await httpApi.put(`/api/settings/accounts/${account.id}`, {
        enabled: !account.enabled,
      });
      fetchAccounts();
      const settingsResp = await httpApi.get('/api/settings/global');
      if (settingsResp.success) {
        setAnthropicAccounts(settingsResp.settings.anthropicAccounts ?? []);
      }
    } catch {
      toast.error('Failed to toggle account');
    }
  };

  const handleMoveAccount = async (account: AccountWithStatus, direction: 'up' | 'down') => {
    const sorted = [...accounts].sort((a, b) => a.priority - b.priority);
    const idx = sorted.findIndex((a) => a.id === account.id);
    if (direction === 'up' && idx <= 0) return;
    if (direction === 'down' && idx >= sorted.length - 1) return;

    const newIdx = direction === 'up' ? idx - 1 : idx + 1;
    const reordered = [...sorted];
    [reordered[idx], reordered[newIdx]] = [reordered[newIdx], reordered[idx]];

    try {
      await httpApi.put('/api/settings/accounts/reorder', {
        orderedIds: reordered.map((a) => a.id),
      });
      fetchAccounts();
      const settingsResp = await httpApi.get('/api/settings/global');
      if (settingsResp.success) {
        setAnthropicAccounts(settingsResp.settings.anthropicAccounts ?? []);
      }
    } catch {
      toast.error('Failed to reorder accounts');
    }
  };

  const handleUpdateFailoverSettings = async (updates: Partial<AccountFailoverSettings>) => {
    try {
      const response = await httpApi.put('/api/settings/accounts/failover', updates);
      if (response.success) {
        setAccountFailoverSettings(response.settings);
      }
    } catch {
      toast.error('Failed to update failover settings');
    }
  };

  const resetForm = () => {
    setFormName('');
    setFormAuthType('api-key');
    setFormApiKey('');
    setFormCredentialsJson('');
    setParsedCredentials(null);
    setCredentialsParseError('');
    setFormError('');
    setShowCredential(false);
  };

  const openEditDialog = (account: AccountWithStatus) => {
    setEditingAccount(account);
    setFormName(account.name);
    setFormAuthType(account.authType || 'api-key');
    setFormApiKey(account.apiKey || '');
    // Don't pre-fill credentials for security — user must re-paste to update
    setFormCredentialsJson('');
    setParsedCredentials(null);
    setCredentialsParseError('');
    setFormError('');
    setShowCredential(false);
  };

  /** Get display string for the credential in the account list */
  const getCredentialDisplay = (account: AccountWithStatus): string => {
    if (account.authType === 'oauth') {
      if (account.oauthCredentials?.accessToken) {
        return account.oauthCredentials.accessToken;
      }
      return account.authToken || '****';
    }
    return account.apiKey || '****';
  };

  /** Check if an OAuth account is missing full credentials (legacy) */
  const isMissingCredentials = (account: AccountWithStatus): boolean => {
    return account.authType === 'oauth' && !account.oauthCredentials;
  };

  const sortedAccounts = [...accounts].sort((a, b) => a.priority - b.priority);

  const isEditing = !!editingAccount;
  const dialogAuthType = isEditing ? editingAccount?.authType || 'api-key' : formAuthType;

  return (
    <div
      className={cn(
        'rounded-2xl overflow-hidden',
        'border border-border/50',
        'bg-linear-to-br from-card/90 via-card/70 to-card/80 backdrop-blur-xl',
        'shadow-sm shadow-black/5'
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-6 border-b border-border/30">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
            <KeyRound className="w-5 h-5 text-emerald-500" />
          </div>
          <div>
            <h3 className="font-semibold text-base flex items-center gap-2">
              Anthropic Accounts
              {accounts.length > 0 && (
                <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-500">
                  {accounts.filter((a) => a.enabled).length} active
                </span>
              )}
            </h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              Pool multiple API keys and OAuth accounts with automatic rate-limit failover
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={fetchAccounts}
            disabled={isLoading}
            className="h-8 w-8"
          >
            <RefreshCw className={cn('w-4 h-4', isLoading && 'animate-spin')} />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              resetForm();
              setShowAddDialog(true);
            }}
            className="gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Add Account
          </Button>
        </div>
      </div>

      {/* Account List */}
      <div className="p-6 space-y-3">
        {sortedAccounts.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <KeyRound className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No accounts configured</p>
            <p className="text-xs mt-1">
              Add Anthropic API keys or Claude Code OAuth accounts for automatic failover
            </p>
          </div>
        ) : (
          sortedAccounts.map((account, idx) => (
            <div
              key={account.id}
              className={cn(
                'flex items-center gap-3 p-4 rounded-xl border transition-all duration-200',
                account.enabled
                  ? 'border-border/50 bg-accent/20 hover:bg-accent/30'
                  : 'border-border/30 bg-muted/10 opacity-60'
              )}
            >
              {/* Priority indicator */}
              <div className="flex flex-col gap-0.5">
                <button
                  onClick={() => handleMoveAccount(account, 'up')}
                  disabled={idx === 0}
                  className={cn(
                    'p-0.5 rounded transition-colors cursor-pointer',
                    idx === 0
                      ? 'text-muted-foreground/20'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <ArrowUp className="w-3 h-3" />
                </button>
                <button
                  onClick={() => handleMoveAccount(account, 'down')}
                  disabled={idx === sortedAccounts.length - 1}
                  className={cn(
                    'p-0.5 rounded transition-colors cursor-pointer',
                    idx === sortedAccounts.length - 1
                      ? 'text-muted-foreground/20'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <ArrowDown className="w-3 h-3" />
                </button>
              </div>

              {/* Account info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{account.name}</span>
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-[10px] px-1.5 py-0',
                      account.authType === 'oauth'
                        ? 'bg-blue-500/10 text-blue-500 border-blue-500/30'
                        : 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30'
                    )}
                  >
                    {account.authType === 'oauth' ? 'OAuth' : 'API Key'}
                  </Badge>
                  <span className="text-xs text-muted-foreground font-mono">
                    {getCredentialDisplay(account)}
                  </span>
                  {isMissingCredentials(account) && (
                    <Badge
                      variant="outline"
                      className="text-xs bg-amber-500/10 text-amber-500 border-amber-500/30"
                    >
                      <AlertTriangle className="w-3 h-3 mr-1" />
                      Re-paste credentials
                    </Badge>
                  )}
                  {account.isRateLimited ? (
                    <Badge variant="destructive" className="text-xs">
                      Rate Limited{' '}
                      {account.resetTimeString ? `(resets ${account.resetTimeString})` : ''}
                    </Badge>
                  ) : account.enabled ? (
                    <Badge
                      variant="outline"
                      className="text-xs bg-emerald-500/10 text-emerald-500 border-emerald-500/30"
                    >
                      Available
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs">
                      Disabled
                    </Badge>
                  )}
                </div>
                {account.oauthCredentials?.subscriptionType && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {account.oauthCredentials.subscriptionType}
                    {account.oauthCredentials.rateLimitTier
                      ? ` (${account.oauthCredentials.rateLimitTier})`
                      : ''}
                  </p>
                )}
                {account.lastUsedAt && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Last used: {new Date(account.lastUsedAt).toLocaleString()}
                  </p>
                )}
              </div>

              {/* Enable/Disable toggle */}
              <Switch
                checked={account.enabled}
                onCheckedChange={() => handleToggleEnabled(account)}
                className="shrink-0"
              />

              {/* Actions menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                    <MoreVertical className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => openEditDialog(account)}>
                    <Pencil className="w-4 h-4 mr-2" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleDeleteAccount(account)}
                    className="text-destructive"
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

      {/* Failover Settings */}
      {accounts.length > 0 && (
        <div className="px-6 pb-6 space-y-4">
          <div className="rounded-xl border border-border/30 bg-muted/30 p-4 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-md bg-emerald-500/20 flex items-center justify-center shrink-0">
                <Shield className="w-3.5 h-3.5 text-emerald-500" />
              </div>
              <h4 className="text-sm font-medium">Failover Settings</h4>
            </div>

            <div className="space-y-3 ml-9">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm">Automatic Failover</Label>
                  <p className="text-xs text-muted-foreground">
                    Switch to next account on rate limit
                  </p>
                </div>
                <Switch
                  checked={accountFailoverSettings.enabled}
                  onCheckedChange={(checked) => handleUpdateFailoverSettings({ enabled: checked })}
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm">Distribute Concurrent</Label>
                  <p className="text-xs text-muted-foreground">
                    Round-robin accounts across parallel features
                  </p>
                </div>
                <Switch
                  checked={accountFailoverSettings.distributeConcurrent}
                  onCheckedChange={(checked) =>
                    handleUpdateFailoverSettings({ distributeConcurrent: checked })
                  }
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm">Reset Buffer</Label>
                  <p className="text-xs text-muted-foreground">
                    Extra seconds to wait after rate limit reset
                  </p>
                </div>
                <Input
                  type="number"
                  min={0}
                  max={300}
                  value={accountFailoverSettings.resetBufferSeconds}
                  onChange={(e) =>
                    handleUpdateFailoverSettings({
                      resetBufferSeconds: parseInt(e.target.value) || 30,
                    })
                  }
                  className="w-20 text-right"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Account Dialog */}
      <Dialog
        open={showAddDialog || !!editingAccount}
        onOpenChange={(open) => {
          if (!open) {
            setShowAddDialog(false);
            setEditingAccount(null);
            resetForm();
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{isEditing ? 'Edit Account' : 'Add Anthropic Account'}</DialogTitle>
            <DialogDescription>
              {isEditing
                ? 'Update the account name or credentials.'
                : 'Add an Anthropic API key or Claude Code OAuth account for multi-account failover.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="account-name">Name</Label>
              <Input
                id="account-name"
                placeholder='e.g., "Personal", "Work Org"'
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </div>

            {/* Auth type selector — only shown when adding, not editing */}
            {!isEditing && (
              <div className="space-y-2">
                <Label>Authentication Type</Label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setFormAuthType('api-key')}
                    className={cn(
                      'flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-all cursor-pointer',
                      formAuthType === 'api-key'
                        ? 'border-emerald-500/50 bg-emerald-500/10 text-foreground'
                        : 'border-border/50 bg-muted/20 text-muted-foreground hover:border-border'
                    )}
                  >
                    <KeyRound className="w-4 h-4" />
                    API Key
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormAuthType('oauth')}
                    className={cn(
                      'flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-all cursor-pointer',
                      formAuthType === 'oauth'
                        ? 'border-blue-500/50 bg-blue-500/10 text-foreground'
                        : 'border-border/50 bg-muted/20 text-muted-foreground hover:border-border'
                    )}
                  >
                    <User className="w-4 h-4" />
                    Claude Code (OAuth)
                  </button>
                </div>
              </div>
            )}

            {/* Credential input — conditional on auth type */}
            {dialogAuthType === 'oauth' ? (
              <div className="space-y-2">
                <Label htmlFor="account-credentials">OAuth Credentials</Label>
                <textarea
                  id="account-credentials"
                  placeholder={
                    'Paste contents of ~/.claude/.credentials.json\n\n{\n  "claudeAiOauth": {\n    "accessToken": "sk-ant-oat...",\n    "refreshToken": "sk-ant-ort...",\n    "expiresAt": 1234567890,\n    ...\n  }\n}'
                  }
                  value={formCredentialsJson}
                  onChange={(e) => setFormCredentialsJson(e.target.value)}
                  rows={6}
                  className={cn(
                    'w-full rounded-md border bg-transparent px-3 py-2 text-xs font-mono',
                    'placeholder:text-muted-foreground/50',
                    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                    'resize-y min-h-[120px]',
                    credentialsParseError && formCredentialsJson.trim()
                      ? 'border-destructive'
                      : parsedCredentials
                        ? 'border-emerald-500/50'
                        : 'border-input'
                  )}
                />
                {/* Validation status */}
                {formCredentialsJson.trim() && (
                  <div className="text-xs">
                    {parsedCredentials ? (
                      <div className="flex items-center gap-1.5 text-emerald-500">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Valid credentials parsed</span>
                        {parsedCredentials.subscriptionType && (
                          <span className="text-muted-foreground">
                            ({parsedCredentials.subscriptionType})
                          </span>
                        )}
                        {parsedCredentials.expiresAt && (
                          <span className="text-muted-foreground">
                            expires{' '}
                            {new Date(parsedCredentials.expiresAt * 1000).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 text-destructive">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>{credentialsParseError}</span>
                      </div>
                    )}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  {isEditing
                    ? 'Paste new credentials to update, or leave empty to keep existing.'
                    : 'Run `claude login` then paste the full JSON file contents.'}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="account-key">API Key</Label>
                <div className="relative">
                  <Input
                    id="account-key"
                    type={showCredential ? 'text' : 'password'}
                    placeholder="sk-ant-api03-..."
                    value={formApiKey}
                    onChange={(e) => setFormApiKey(e.target.value)}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCredential(!showCredential)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    {showCredential ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {isEditing && (
                  <p className="text-xs text-muted-foreground">
                    Leave unchanged to keep existing key. Enter a new key to replace.
                  </p>
                )}
              </div>
            )}

            {formError && <p className="text-sm text-destructive">{formError}</p>}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowAddDialog(false);
                setEditingAccount(null);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={isEditing ? handleUpdateAccount : handleAddAccount}
              disabled={isSaving}
            >
              {isSaving ? 'Validating...' : isEditing ? 'Save' : 'Add Account'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
