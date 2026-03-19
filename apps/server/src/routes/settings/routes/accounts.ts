/**
 * Anthropic Accounts routes - CRUD for multi-account failover
 *
 * Endpoints:
 * - GET /          - Get all accounts with computed status
 * - POST /         - Add new account (validates API key or OAuth credentials)
 * - PUT /:id       - Update account (name, enabled, apiKey, oauthCredentials)
 * - DELETE /:id    - Delete account (cleans up per-account HOME dir)
 * - PUT /reorder   - Update priority order
 * - GET /failover  - Get failover settings
 * - PUT /failover  - Update failover settings
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import type { SettingsService } from '../../../services/settings-service.js';
import type { AccountManager } from '../../../services/account-manager.js';
import type {
  AnthropicAccount,
  AnthropicAuthType,
  AccountFailoverSettings,
  ClaudeOAuthCredentials,
} from '@automaker/types';
import { getErrorMessage, logError } from '../common.js';

/**
 * Validate an Anthropic API key by making a lightweight API call.
 * Uses the models list endpoint which is fast and low-cost.
 */
async function validateApiKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const response = await fetch('https://api.anthropic.com/v1/models', {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    });

    if (response.ok) {
      return { valid: true };
    }

    if (response.status === 401) {
      return { valid: false, error: 'Invalid API key' };
    }

    // Rate limited or other error — key format is likely valid
    if (response.status === 429) {
      return { valid: true };
    }

    return { valid: false, error: `API returned status ${response.status}` };
  } catch (error) {
    return { valid: false, error: `Failed to validate: ${getErrorMessage(error)}` };
  }
}

/**
 * Validate OAuth credentials object from ~/.claude/.credentials.json.
 * Checks the structure and token format.
 */
function validateOAuthCredentials(creds: unknown): {
  valid: boolean;
  credentials?: ClaudeOAuthCredentials;
  error?: string;
} {
  if (!creds || typeof creds !== 'object') {
    return { valid: false, error: 'Credentials must be an object' };
  }

  const obj = creds as Record<string, unknown>;

  // Check required fields
  if (!obj.accessToken || typeof obj.accessToken !== 'string') {
    return { valid: false, error: 'Missing or invalid accessToken' };
  }
  if (!obj.refreshToken || typeof obj.refreshToken !== 'string') {
    return { valid: false, error: 'Missing or invalid refreshToken' };
  }
  if (typeof obj.expiresAt !== 'number') {
    return { valid: false, error: 'Missing or invalid expiresAt (must be a number)' };
  }

  // Check token format prefixes
  if (!obj.accessToken.startsWith('sk-ant-oat')) {
    return {
      valid: false,
      error: 'accessToken does not look like a Claude OAuth token (expected sk-ant-oat... prefix)',
    };
  }
  if (!obj.refreshToken.startsWith('sk-ant-ort')) {
    return {
      valid: false,
      error:
        'refreshToken does not look like a Claude OAuth refresh token (expected sk-ant-ort... prefix)',
    };
  }

  // Validate optional fields
  if (obj.scopes !== undefined && !Array.isArray(obj.scopes)) {
    return { valid: false, error: 'scopes must be an array if provided' };
  }

  const credentials: ClaudeOAuthCredentials = {
    accessToken: obj.accessToken,
    refreshToken: obj.refreshToken,
    expiresAt: obj.expiresAt,
    ...(Array.isArray(obj.scopes) && { scopes: obj.scopes as string[] }),
    ...(typeof obj.subscriptionType === 'string' && { subscriptionType: obj.subscriptionType }),
    ...(typeof obj.rateLimitTier === 'string' && { rateLimitTier: obj.rateLimitTier }),
  };

  return { valid: true, credentials };
}

/**
 * Mask a credential for safe display (show first 7 and last 4 characters).
 */
function maskCredential(value: string | undefined): string {
  if (!value) return '****';
  if (value.length <= 12) return '****';
  return `${value.substring(0, 7)}...${value.substring(value.length - 4)}`;
}

/**
 * Mask the appropriate credential field on an account based on authType.
 */
function maskAccountCredentials(
  account: AnthropicAccount & Record<string, any>
): Record<string, any> {
  const masked: Record<string, any> = {
    ...account,
    apiKey: account.authType === 'oauth' ? undefined : maskCredential(account.apiKey),
    authToken: account.authType === 'oauth' ? maskCredential(account.authToken) : undefined,
  };

  // Mask oauthCredentials tokens
  if (account.oauthCredentials) {
    masked.oauthCredentials = {
      ...account.oauthCredentials,
      accessToken: maskCredential(account.oauthCredentials.accessToken),
      refreshToken: maskCredential(account.oauthCredentials.refreshToken),
    };
  }

  return masked;
}

export function createAccountRoutes(
  settingsService: SettingsService,
  accountManager: AccountManager
): Router {
  const router = Router();

  // GET / - Get all accounts with computed status
  router.get('/', async (_req: Request, res: Response): Promise<void> => {
    try {
      const statuses = await accountManager.getAccountStatuses();

      // Mask credentials before sending to client
      const masked = statuses.map((account) => maskAccountCredentials(account));

      res.json({ success: true, accounts: masked });
    } catch (error) {
      logError(error, 'Get accounts failed');
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  });

  // POST / - Add new account
  router.post('/', async (req: Request, res: Response): Promise<void> => {
    try {
      const { name, authType, apiKey, oauthCredentials } = req.body as {
        name?: string;
        authType?: AnthropicAuthType;
        apiKey?: string;
        oauthCredentials?: unknown;
      };

      if (!name) {
        res.status(400).json({ success: false, error: 'Name is required' });
        return;
      }

      const resolvedAuthType: AnthropicAuthType = authType || 'api-key';

      // Validate the credential based on auth type
      let validatedCredentials: ClaudeOAuthCredentials | undefined;
      if (resolvedAuthType === 'oauth') {
        if (!oauthCredentials) {
          res.status(400).json({
            success: false,
            error:
              'OAuth credentials are required for OAuth accounts. Paste the contents of ~/.claude/.credentials.json.',
          });
          return;
        }
        const validation = validateOAuthCredentials(oauthCredentials);
        if (!validation.valid) {
          res.status(400).json({
            success: false,
            error: validation.error || 'Invalid OAuth credentials',
          });
          return;
        }
        validatedCredentials = validation.credentials;
      } else {
        if (!apiKey) {
          res.status(400).json({
            success: false,
            error: 'API key is required for API key accounts',
          });
          return;
        }
        const validation = await validateApiKey(apiKey);
        if (!validation.valid) {
          res.status(400).json({
            success: false,
            error: validation.error || 'Invalid API key',
          });
          return;
        }
      }

      const settings = await settingsService.getGlobalSettings();
      const accounts = settings.anthropicAccounts ?? [];

      const newAccount: AnthropicAccount = {
        id: randomUUID(),
        name,
        authType: resolvedAuthType,
        apiKey: resolvedAuthType === 'oauth' ? undefined : apiKey,
        oauthCredentials: validatedCredentials,
        enabled: true,
        priority: accounts.length, // Add at end
        rateLimitEvents: [],
        createdAt: new Date().toISOString(),
      };

      accounts.push(newAccount);
      await settingsService.updateGlobalSettings({ anthropicAccounts: accounts });

      // Create per-account HOME dir for OAuth accounts
      if (resolvedAuthType === 'oauth') {
        await accountManager.ensureAccountHomeDir(newAccount);
      }

      res.json({
        success: true,
        account: maskAccountCredentials(newAccount),
      });
    } catch (error) {
      logError(error, 'Add account failed');
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  });

  // PUT /:id - Update account
  router.put('/:id', async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const updates = req.body as Partial<Pick<AnthropicAccount, 'name' | 'apiKey' | 'enabled'>> & {
        oauthCredentials?: unknown;
      };

      const settings = await settingsService.getGlobalSettings();
      const accounts = settings.anthropicAccounts ?? [];
      const account = accounts.find((a) => a.id === id);

      if (!account) {
        res.status(404).json({ success: false, error: 'Account not found' });
        return;
      }

      // If API key is being changed, validate it (only for api-key accounts)
      if (account.authType !== 'oauth' && updates.apiKey && updates.apiKey !== account.apiKey) {
        const validation = await validateApiKey(updates.apiKey);
        if (!validation.valid) {
          res.status(400).json({
            success: false,
            error: validation.error || 'Invalid API key',
          });
          return;
        }
        account.apiKey = updates.apiKey;
      }

      // If OAuth credentials are being updated
      if (account.authType === 'oauth' && updates.oauthCredentials) {
        const validation = validateOAuthCredentials(updates.oauthCredentials);
        if (!validation.valid) {
          res.status(400).json({
            success: false,
            error: validation.error || 'Invalid OAuth credentials',
          });
          return;
        }
        account.oauthCredentials = validation.credentials;
        // Re-create HOME dir with updated credentials
        await accountManager.ensureAccountHomeDir(account);
      }

      if (updates.name !== undefined) account.name = updates.name;
      if (updates.enabled !== undefined) account.enabled = updates.enabled;

      await settingsService.updateGlobalSettings({ anthropicAccounts: accounts });

      res.json({
        success: true,
        account: maskAccountCredentials(account),
      });
    } catch (error) {
      logError(error, 'Update account failed');
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  });

  // DELETE /:id - Delete account
  router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      const settings = await settingsService.getGlobalSettings();
      const accounts = settings.anthropicAccounts ?? [];
      const index = accounts.findIndex((a) => a.id === id);

      if (index === -1) {
        res.status(404).json({ success: false, error: 'Account not found' });
        return;
      }

      accounts.splice(index, 1);

      // Re-number priorities
      accounts.forEach((a, i) => {
        a.priority = i;
      });

      await settingsService.updateGlobalSettings({ anthropicAccounts: accounts });

      // Clean up per-account HOME directory
      await accountManager.removeAccountHomeDir(id);

      res.json({ success: true });
    } catch (error) {
      logError(error, 'Delete account failed');
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  });

  // PUT /reorder - Update priority order
  router.put('/reorder', async (req: Request, res: Response): Promise<void> => {
    try {
      const { orderedIds } = req.body as { orderedIds?: string[] };

      if (!orderedIds || !Array.isArray(orderedIds)) {
        res.status(400).json({
          success: false,
          error: 'orderedIds array is required',
        });
        return;
      }

      const settings = await settingsService.getGlobalSettings();
      const accounts = settings.anthropicAccounts ?? [];

      // Reorder accounts based on the provided ID order
      const reordered: AnthropicAccount[] = [];
      for (let i = 0; i < orderedIds.length; i++) {
        const account = accounts.find((a) => a.id === orderedIds[i]);
        if (account) {
          account.priority = i;
          reordered.push(account);
        }
      }

      // Append any accounts not in the ordered list (shouldn't happen, but defensive)
      for (const account of accounts) {
        if (!reordered.includes(account)) {
          account.priority = reordered.length;
          reordered.push(account);
        }
      }

      await settingsService.updateGlobalSettings({ anthropicAccounts: reordered });

      res.json({ success: true });
    } catch (error) {
      logError(error, 'Reorder accounts failed');
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  });

  // GET /failover - Get failover settings
  router.get('/failover', async (_req: Request, res: Response): Promise<void> => {
    try {
      const settings = await settingsService.getGlobalSettings();
      const failoverSettings = settings.accountFailoverSettings ?? {
        enabled: true,
        distributeConcurrent: true,
        resetBufferSeconds: 30,
      };

      res.json({ success: true, settings: failoverSettings });
    } catch (error) {
      logError(error, 'Get failover settings failed');
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  });

  // PUT /failover - Update failover settings
  router.put('/failover', async (req: Request, res: Response): Promise<void> => {
    try {
      const updates = req.body as Partial<AccountFailoverSettings>;

      if (!updates || typeof updates !== 'object') {
        res.status(400).json({
          success: false,
          error: 'Invalid request body',
        });
        return;
      }

      const settings = await settingsService.getGlobalSettings();
      const current = settings.accountFailoverSettings ?? {
        enabled: true,
        distributeConcurrent: true,
        resetBufferSeconds: 30,
      };

      const updated: AccountFailoverSettings = {
        ...current,
        ...updates,
      };

      await settingsService.updateGlobalSettings({ accountFailoverSettings: updated });

      res.json({ success: true, settings: updated });
    } catch (error) {
      logError(error, 'Update failover settings failed');
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  });

  return router;
}
