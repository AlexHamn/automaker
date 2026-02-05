/**
 * Convex RAG Service
 *
 * Provides server-side access to the Convex RAG (Retrieval-Augmented Generation)
 * backend for semantic search and knowledge base operations.
 */

import { ConvexHttpClient } from 'convex/browser';
import { createLogger } from '@automaker/utils';

const logger = createLogger('ConvexRAGService');

export interface ConvexRAGConfig {
  url: string | undefined;
  deployKey: string | undefined;
  enabled: boolean;
}

export interface ConfigStatus {
  enabled: boolean;
  configured: boolean;
  url?: string;
}

export interface HealthStatus extends ConfigStatus {
  connected?: boolean;
  error?: string;
}

/**
 * Service for managing Convex RAG operations
 */
class ConvexRAGService {
  private client: ConvexHttpClient | null = null;
  private config: ConvexRAGConfig;

  constructor() {
    this.config = {
      url: process.env.CONVEX_URL,
      deployKey: process.env.CONVEX_DEPLOY_KEY,
      enabled: process.env.AUTOMAKER_RAG_ENABLED === 'true',
    };

    if (this.config.enabled && this.config.url) {
      this.initializeClient();
    }
  }

  private initializeClient(): void {
    if (!this.config.url) {
      logger.warn('Cannot initialize Convex client: CONVEX_URL not set');
      return;
    }

    try {
      this.client = new ConvexHttpClient(this.config.url);

      if (this.config.deployKey) {
        // setAdminAuth exists at runtime but is not in the public type declarations
        (this.client as unknown as { setAdminAuth(token: string): void }).setAdminAuth(
          this.config.deployKey,
        );
        logger.info('Convex RAG client initialized with admin auth', {
          url: this.maskUrl(this.config.url),
        });
      } else {
        logger.info('Convex RAG client initialized (no deploy key)', {
          url: this.maskUrl(this.config.url),
        });
      }
    } catch (error) {
      logger.error('Failed to initialize Convex client', { error });
      this.client = null;
    }
  }

  /**
   * Check if RAG service is available (enabled and properly configured)
   */
  isAvailable(): boolean {
    return this.config.enabled && this.client !== null;
  }

  /**
   * Check if RAG feature is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Check if service is configured (has URL set)
   */
  isConfigured(): boolean {
    return !!this.config.url;
  }

  /**
   * Get the Convex HTTP client (may be null if not configured)
   */
  getClient(): ConvexHttpClient | null {
    return this.client;
  }

  /**
   * Get configuration status for health endpoint
   */
  getConfigStatus(): ConfigStatus {
    return {
      enabled: this.config.enabled,
      configured: this.isConfigured(),
      url: this.config.url ? this.maskUrl(this.config.url) : undefined,
    };
  }

  /**
   * Check health of Convex connection by executing a lightweight query.
   */
  async checkHealth(): Promise<HealthStatus> {
    const status = this.getConfigStatus();

    if (!this.client) {
      return {
        ...status,
        connected: false,
        error: !this.config.enabled ? 'RAG feature is disabled' : 'Convex client not initialized',
      };
    }

    try {
      // Use the health:ping query to verify the connection is alive
      const { makeFunctionReference } = await import('convex/server');
      const pingRef = makeFunctionReference<'query'>('health:ping');
      await this.client.query(pingRef);
      return {
        ...status,
        connected: true,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Convex health check failed', { error: errorMessage });
      return {
        ...status,
        connected: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Mask URL for safe logging (hide sensitive parts)
   */
  private maskUrl(url: string): string {
    try {
      const parsed = new URL(url);
      return `${parsed.protocol}//${parsed.hostname}`;
    } catch {
      return '[invalid url]';
    }
  }
}

// Singleton instance
let instance: ConvexRAGService | null = null;

/**
 * Get the singleton ConvexRAGService instance
 */
export function getConvexRAGService(): ConvexRAGService {
  if (!instance) {
    instance = new ConvexRAGService();
  }
  return instance;
}
