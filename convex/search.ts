/**
 * Convex Search Functions
 *
 * Provides actions for semantic search across indexed context and memory
 * files using the RAG system.
 */

import { v } from 'convex/values';
import { action } from './_generated/server';
import { rag } from './rag';

/**
 * Search for context relevant to a feature
 *
 * Uses semantic search to find the most relevant context and memory
 * chunks for a given feature description or query.
 */
export const searchFeatureContext = action({
  args: {
    projectId: v.string(),
    query: v.string(),
    contentType: v.optional(v.string()),
    limit: v.optional(v.number()),
    vectorScoreThreshold: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { projectId, query, contentType, limit = 10, vectorScoreThreshold = 0.3 } = args;

    const namespace = `project:${projectId}`;

    // Build filters — always filter by projectId
    const filters: Array<{ projectId: string; contentType?: string }> = contentType
      ? [{ projectId, contentType }]
      : [{ projectId }];

    const result = await rag.search(ctx, {
      namespace,
      query,
      filters,
      limit,
      vectorScoreThreshold,
      chunkContext: { before: 1, after: 1 },
    });

    return {
      results: result.results,
      text: result.text,
      entries: result.entries,
      usage: result.usage,
    };
  },
});
