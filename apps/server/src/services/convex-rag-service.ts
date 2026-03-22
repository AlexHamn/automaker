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

export interface SearchOptions {
  contentType?: string;
  limit?: number;
  vectorScoreThreshold?: number;
}

export interface SearchResult {
  context: string;
  sources: string[];
  chunksRetrieved: number;
  latencyMs: number;
}

export interface RiskFactor {
  type: 'similar_failures' | 'gotcha_matches' | 'no_prior_work';
  description: string;
  weight: number;
}

export interface RiskAssessment {
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high';
  factors: RiskFactor[];
  recommendations: string[];
  similarFeatureCount: number;
  latencyMs: number;
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
   * Search indexed content for context relevant to a query
   */
  async searchFeatureContext(
    projectPath: string,
    query: string,
    options: SearchOptions = {}
  ): Promise<SearchResult> {
    const startTime = Date.now();
    const emptyResult: SearchResult = {
      context: '',
      sources: [],
      chunksRetrieved: 0,
      latencyMs: 0,
    };

    if (!this.client) {
      return emptyResult;
    }

    const projectId = getProjectId(projectPath);
    const { contentType, limit = 10, vectorScoreThreshold = 0.3 } = options;

    try {
      const { makeFunctionReference } = await import('convex/server');
      const ref = makeFunctionReference<'action'>('search:searchFeatureContext');
      const result = await this.client.action(ref, {
        projectId,
        query,
        contentType,
        limit,
        vectorScoreThreshold,
      });

      const latencyMs = Date.now() - startTime;
      const sources = result.entries
        .map((e: { key?: string; title?: string }) => e.key || e.title || 'unknown')
        .filter((s: string) => s !== 'unknown');

      logger.info('RAG search completed', {
        projectId,
        chunksRetrieved: result.results.length,
        sources,
        latencyMs,
      });

      return {
        context: result.text,
        sources,
        chunksRetrieved: result.results.length,
        latencyMs,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('RAG search failed', { projectId, error: errorMessage });
      return { ...emptyResult, latencyMs: Date.now() - startTime };
    }
  }

  /**
   * Search and format results for injection into agent prompts.
   * Returns a formatted markdown section or null if no results.
   */
  async searchForAgent(
    projectPath: string,
    message: string,
    options: SearchOptions = {}
  ): Promise<string | null> {
    if (!this.isAvailable()) {
      return null;
    }

    try {
      const result = await this.searchFeatureContext(projectPath, message, options);

      if (!result.context || result.chunksRetrieved === 0) {
        return null;
      }

      const sourceList =
        result.sources.length > 0
          ? `\n<!-- RAG sources: ${result.sources.join(', ')} | ${result.chunksRetrieved} chunks | ${result.latencyMs}ms -->`
          : '';

      return `## Relevant Knowledge Base Context\n\nThe following context was retrieved from the project knowledge base based on semantic relevance to this task:\n\n${result.context}${sourceList}`;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('RAG searchForAgent failed', { error: errorMessage });
      return null;
    }
  }

  /**
   * Find similar past implementations by searching agent-output content
   */
  async findSimilarImplementations(
    projectPath: string,
    description: string,
    category?: string,
    limit?: number
  ): Promise<SearchResult> {
    return this.searchFeatureContext(projectPath, description, {
      contentType: 'agent-output',
      limit: limit ?? 5,
    });
  }

  /**
   * Search for gotchas and potential issues relevant to a task description.
   * Searches memory files (which include gotchas.md) with a lower score threshold.
   */
  async searchGotchas(
    projectPath: string,
    taskDescription: string,
    limit?: number
  ): Promise<SearchResult> {
    return this.searchFeatureContext(projectPath, taskDescription, {
      contentType: 'memory',
      limit: limit ?? 5,
      vectorScoreThreshold: 0.3,
    });
  }

  /**
   * Find relevant code patterns by searching indexed codebase content
   */
  async findCodePatterns(
    projectPath: string,
    query: string,
    patternType?: string,
    limit?: number
  ): Promise<SearchResult> {
    return this.searchFeatureContext(projectPath, query, {
      contentType: 'code',
      limit: limit ?? 5,
    });
  }

  /**
   * Assess risk for a feature based on similar past outcomes and gotcha matches.
   */
  async assessFeatureRisk(
    projectPath: string,
    featureTitle: string,
    featureDescription: string,
    category?: string
  ): Promise<RiskAssessment> {
    const startTime = Date.now();
    const query = `${featureTitle || ''} ${featureDescription}`.trim();
    const factors: RiskFactor[] = [];
    const recommendations: string[] = [];
    let riskScore = 0;
    let similarFeatureCount = 0;

    if (!this.isAvailable() || !query) {
      return {
        riskScore: 0,
        riskLevel: 'low',
        factors: [],
        recommendations: [],
        similarFeatureCount: 0,
        latencyMs: Date.now() - startTime,
      };
    }

    // Factor 1: Search for similar past implementations (success vs failure)
    try {
      const similarResult = await this.findSimilarImplementations(projectPath, query, category, 10);
      similarFeatureCount = similarResult.chunksRetrieved;

      if (similarFeatureCount > 0) {
        // Lower-scored results likely came from failed features (indexed with importance 0.4)
        // Higher-scored results from successful features (importance 0.8)
        // Use the context to estimate failure ratio
        const failureIndicators = (similarResult.context.match(/Status:\s*Failed/gi) || []).length;
        const totalMentions = Math.max(similarFeatureCount, 1);
        const failureRatio = failureIndicators / totalMentions;

        if (failureRatio > 0) {
          const weight = failureRatio * 0.4;
          riskScore += weight;
          factors.push({
            type: 'similar_failures',
            description: `${failureIndicators} of ${totalMentions} similar features had failures`,
            weight,
          });
          recommendations.push('Review past failures for common pitfalls before starting');
        }
      } else {
        // No prior work in this area
        riskScore += 0.3;
        factors.push({
          type: 'no_prior_work',
          description: 'No similar features found in the knowledge base',
          weight: 0.3,
        });
        recommendations.push('This is new territory — consider breaking into smaller tasks');
      }
    } catch {
      // Search failed — don't block risk assessment
    }

    // Factor 2: Search for relevant gotchas
    try {
      const gotchaResult = await this.searchGotchas(projectPath, query);
      const gotchaCount = gotchaResult.chunksRetrieved;

      if (gotchaCount > 0) {
        const weight = Math.min(gotchaCount / 5, 1) * 0.3;
        riskScore += weight;
        factors.push({
          type: 'gotcha_matches',
          description: `${gotchaCount} potential gotcha${gotchaCount > 1 ? 's' : ''} found`,
          weight,
        });
        recommendations.push('Review the gotcha warnings before implementation');
      }
    } catch {
      // Search failed — don't block risk assessment
    }

    const riskLevel = riskScore < 0.3 ? 'low' : riskScore < 0.6 ? 'medium' : 'high';

    return {
      riskScore: Math.min(riskScore, 1),
      riskLevel,
      factors,
      recommendations,
      similarFeatureCount,
      latencyMs: Date.now() - startTime,
    };
  }

  /**
   * Index codebase source files by extracting patterns from TS/JS files
   */
  async indexCodebase(projectPath: string): Promise<IndexProjectResult> {
    if (!this.client) {
      return {
        projectId: getProjectId(projectPath),
        contextFiles: [],
        memoryFiles: [],
        summary: { total: 0, indexed: 0, skipped: 0, failed: 0, duration: 0 },
      };
    }

    const startTime = Date.now();
    const projectId = getProjectId(projectPath);
    const codeFiles: IndexResult[] = [];

    logger.info('Starting codebase indexing', { projectPath, projectId });

    // Lazy import to avoid circular dependencies
    const { shouldSkipDir, shouldIndexFile, extractPatterns } =
      await import('./code-pattern-extractor.js');

    // Recursive directory scanner
    const scanDir = async (dirPath: string): Promise<void> => {
      try {
        const entries = await secureFs.readdir(dirPath);
        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry);
          try {
            const stats = await secureFs.stat(fullPath);
            if (stats.isDirectory()) {
              if (!shouldSkipDir(entry)) {
                await scanDir(fullPath);
              }
            } else if (stats.isFile()) {
              if (!shouldIndexFile(fullPath, Number(stats.size))) continue;

              const relativePath = path.relative(projectPath, fullPath);
              try {
                const content = (await secureFs.readFile(fullPath, 'utf-8')) as string;
                const checksum = computeChecksum(content);

                const needsIndex = await this.needsReindexing(projectId, relativePath, checksum);
                if (!needsIndex) {
                  codeFiles.push({ filePath: relativePath, status: 'skipped' });
                  continue;
                }

                const { patternType, enrichedContent } = extractPatterns(relativePath, content);

                const { makeFunctionReference } = await import('convex/server');
                const ref = makeFunctionReference<'action'>('indexing:indexCodePattern');
                await this.client!.action(ref, {
                  projectId,
                  filePath: relativePath,
                  content: enrichedContent,
                  contentHash: checksum,
                  patternType,
                  title: path.basename(fullPath),
                });

                codeFiles.push({ filePath: relativePath, status: 'indexed' });
              } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                codeFiles.push({ filePath: relativePath, status: 'failed', error: errorMessage });
              }
            }
          } catch {
            // Skip files we can't stat
          }
        }
      } catch {
        // Skip directories we can't read
      }
    };

    // Scan common source directories
    for (const srcDir of ['src', 'libs', 'lib', 'app', 'apps']) {
      const dirPath = path.join(projectPath, srcDir);
      try {
        await secureFs.access(dirPath);
        await scanDir(dirPath);
      } catch {
        // Directory doesn't exist
      }
    }

    const duration = Date.now() - startTime;
    const result: IndexProjectResult = {
      projectId,
      contextFiles: [],
      memoryFiles: codeFiles,
      summary: {
        total: codeFiles.length,
        indexed: codeFiles.filter((r) => r.status === 'indexed').length,
        skipped: codeFiles.filter((r) => r.status === 'skipped').length,
        failed: codeFiles.filter((r) => r.status === 'failed').length,
        duration,
      },
    };

    logger.info('Codebase indexing complete', { projectId, ...result.summary });
    return result;
  }

  /**
   * Index agent output from a completed feature into the RAG knowledge base
   */
  async indexFeatureOutput(
    projectPath: string,
    featureId: string,
    featureTitle: string,
    category: string,
    agentOutput: string,
    wasSuccessful: boolean
  ): Promise<IndexResult> {
    if (!this.client) {
      return {
        filePath: `features/${featureId}/agent-output.md`,
        status: 'failed',
        error: 'RAG service not available',
      };
    }

    const projectId = getProjectId(projectPath);
    const filePath = `features/${featureId}/agent-output.md`;

    try {
      const checksum = computeChecksum(agentOutput);

      // Check if needs reindexing
      const needsIndex = await this.needsReindexing(projectId, filePath, checksum);
      if (!needsIndex) {
        return { filePath, status: 'skipped' };
      }

      const { makeFunctionReference } = await import('convex/server');
      const ref = makeFunctionReference<'action'>('indexing:indexAgentOutput');
      await this.client.action(ref, {
        projectId,
        featureId,
        featureTitle,
        category,
        agentOutput,
        contentHash: checksum,
        wasSuccessful,
      });

      logger.info('Indexed feature output', {
        projectId,
        featureId,
        featureTitle,
        wasSuccessful,
      });
      return { filePath, status: 'indexed' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to index feature output', { featureId, error: errorMessage });
      return { filePath, status: 'failed', error: errorMessage };
    }
  }

  /**
   * Remove a file from the RAG index (e.g., when deleted from disk)
   */
  async removeFromIndex(projectPath: string, filePath: string): Promise<void> {
    if (!this.client) return;

    const projectId = getProjectId(projectPath);

    try {
      const { makeFunctionReference } = await import('convex/server');
      const ref = makeFunctionReference<'mutation'>('indexing:removeIndexedContent');
      await this.client.mutation(ref, { projectId, filePath });
      logger.info('Removed file from index', { projectId, filePath });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to remove file from index', { filePath, error: errorMessage });
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
