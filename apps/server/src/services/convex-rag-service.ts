/**
 * Convex RAG Service
 *
 * Provides server-side access to the Convex RAG (Retrieval-Augmented Generation)
 * backend for semantic search and knowledge base operations.
 */

import path from 'path';
import { ConvexHttpClient } from 'convex/browser';
import { createLogger, parseFrontmatter } from '@automaker/utils';
import { secureFs } from '@automaker/platform';
import { computeChecksum, getProjectId } from '../lib/file-utils.js';

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

export interface IndexResult {
  filePath: string;
  status: 'indexed' | 'skipped' | 'failed';
  error?: string;
}

export interface IndexProjectResult {
  projectId: string;
  contextFiles: IndexResult[];
  memoryFiles: IndexResult[];
  summary: {
    total: number;
    indexed: number;
    skipped: number;
    failed: number;
    duration: number;
  };
}

// Cooldown period for stale indexing (5 minutes)
const STALE_INDEX_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Service for managing Convex RAG operations
 */
class ConvexRAGService {
  private client: ConvexHttpClient | null = null;
  private config: ConvexRAGConfig;
  private lastIndexedTimestamps = new Map<string, number>();

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
          this.config.deployKey
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
   * Index all context and memory files for a project
   *
   * Discovers files in .automaker/context/ and .automaker/memory/,
   * computes checksums, and indexes only changed files.
   */
  async indexProject(projectPath: string): Promise<IndexProjectResult> {
    const startTime = Date.now();
    const projectId = getProjectId(projectPath);

    logger.info('Starting project indexing', { projectPath, projectId });

    const contextFiles: IndexResult[] = [];
    const memoryFiles: IndexResult[] = [];

    // Index context files
    const contextDir = path.join(projectPath, '.automaker', 'context');
    try {
      await secureFs.access(contextDir);
      const files = await secureFs.readdir(contextDir);
      for (const file of files) {
        if (file.endsWith('.md') || file.endsWith('.txt')) {
          const filePath = path.join(contextDir, file);
          const result = await this.indexContextFile(projectPath, filePath);
          contextFiles.push(result);
        }
      }
    } catch {
      // Context directory doesn't exist, skip
      logger.debug('No context directory found', { contextDir });
    }

    // Index memory files
    const memoryDir = path.join(projectPath, '.automaker', 'memory');
    try {
      await secureFs.access(memoryDir);
      const files = await secureFs.readdir(memoryDir);
      for (const file of files) {
        if (file.endsWith('.md') && file !== '_index.md') {
          const filePath = path.join(memoryDir, file);
          const result = await this.indexMemoryFile(projectPath, filePath);
          memoryFiles.push(result);
        }
      }
    } catch {
      // Memory directory doesn't exist, skip
      logger.debug('No memory directory found', { memoryDir });
    }

    const allResults = [...contextFiles, ...memoryFiles];
    const duration = Date.now() - startTime;

    const result: IndexProjectResult = {
      projectId,
      contextFiles,
      memoryFiles,
      summary: {
        total: allResults.length,
        indexed: allResults.filter((r) => r.status === 'indexed').length,
        skipped: allResults.filter((r) => r.status === 'skipped').length,
        failed: allResults.filter((r) => r.status === 'failed').length,
        duration,
      },
    };

    // Update last indexed timestamp
    this.lastIndexedTimestamps.set(projectId, Date.now());

    logger.info('Project indexing complete', {
      projectId,
      ...result.summary,
    });

    return result;
  }

  /**
   * Index a single context file
   */
  async indexContextFile(projectPath: string, filePath: string): Promise<IndexResult> {
    if (!this.client) {
      return { filePath, status: 'failed', error: 'RAG service not available' };
    }

    const projectId = getProjectId(projectPath);
    const relativePath = path.relative(projectPath, filePath);

    try {
      // Read file content
      const content = (await secureFs.readFile(filePath, 'utf-8')) as string;
      const checksum = computeChecksum(content);

      // Check if needs reindexing
      const needsIndex = await this.needsReindexing(projectId, relativePath, checksum);
      if (!needsIndex) {
        return { filePath: relativePath, status: 'skipped' };
      }

      // Extract title from filename
      const title = path.basename(filePath, path.extname(filePath));

      // Call Convex action
      const { makeFunctionReference } = await import('convex/server');
      const ref = makeFunctionReference<'action'>('indexing:indexContextFile');
      await this.client.action(ref, {
        projectId,
        filePath: relativePath,
        content,
        contentHash: checksum,
        title,
        category: 'general',
        importance: 0.7,
      });

      logger.debug('Indexed context file', { filePath: relativePath });
      return { filePath: relativePath, status: 'indexed' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to index context file', { filePath: relativePath, error: errorMessage });
      return { filePath: relativePath, status: 'failed', error: errorMessage };
    }
  }

  /**
   * Index a single memory file
   */
  async indexMemoryFile(projectPath: string, filePath: string): Promise<IndexResult> {
    if (!this.client) {
      return { filePath, status: 'failed', error: 'RAG service not available' };
    }

    const projectId = getProjectId(projectPath);
    const relativePath = path.relative(projectPath, filePath);

    try {
      // Read file content
      const content = (await secureFs.readFile(filePath, 'utf-8')) as string;
      const checksum = computeChecksum(content);

      // Check if needs reindexing
      const needsIndex = await this.needsReindexing(projectId, relativePath, checksum);
      if (!needsIndex) {
        return { filePath: relativePath, status: 'skipped' };
      }

      // Parse frontmatter for metadata
      const { metadata, body } = parseFrontmatter(content);

      // Extract category from filename (e.g., "gotchas.md" -> "gotchas")
      const category = path.basename(filePath, '.md');

      // Call Convex action
      const { makeFunctionReference } = await import('convex/server');
      const ref = makeFunctionReference<'action'>('indexing:indexMemoryFile');
      await this.client.action(ref, {
        projectId,
        filePath: relativePath,
        content: body,
        contentHash: checksum,
        tags: metadata.tags,
        importance: metadata.importance,
        summary: metadata.summary,
        category,
      });

      logger.debug('Indexed memory file', { filePath: relativePath });
      return { filePath: relativePath, status: 'indexed' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to index memory file', { filePath: relativePath, error: errorMessage });
      return { filePath: relativePath, status: 'failed', error: errorMessage };
    }
  }

  /**
   * Check if a file needs reindexing by comparing checksums
   */
  private async needsReindexing(
    projectId: string,
    filePath: string,
    checksum: string
  ): Promise<boolean> {
    if (!this.client) {
      return false;
    }

    try {
      const { makeFunctionReference } = await import('convex/server');
      const ref = makeFunctionReference<'query'>('indexing:getIndexedContent');
      const existing = await this.client.query(ref, { projectId, filePath });

      if (!existing) {
        return true; // Never indexed
      }

      return existing.checksum !== checksum; // Different checksum means content changed
    } catch {
      // If we can't check, assume we need to reindex
      return true;
    }
  }

  /**
   * Index project if it hasn't been indexed recently
   *
   * Uses a 5-minute cooldown per project to avoid repeated indexing
   * on rapid feature list requests.
   */
  async indexProjectIfStale(projectPath: string): Promise<void> {
    if (!this.isAvailable()) {
      return;
    }

    const projectId = getProjectId(projectPath);
    const lastIndexed = this.lastIndexedTimestamps.get(projectId);
    const now = Date.now();

    if (lastIndexed && now - lastIndexed < STALE_INDEX_COOLDOWN_MS) {
      logger.debug('Skipping project indexing (within cooldown)', {
        projectId,
        lastIndexed: new Date(lastIndexed).toISOString(),
      });
      return;
    }

    logger.info('Background RAG indexing starting', { projectId });
    try {
      await this.indexProject(projectPath);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Background RAG indexing failed', { projectId, error: errorMessage });
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
