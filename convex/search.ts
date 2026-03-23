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

    // Namespace already isolates by project. Filters are OR'd by the RAG component,
    // so we only add a contentType filter when we need to narrow results to a specific type.
    const filters: Array<{ name: string; value: string | number }> = [];
    if (contentType) {
      filters.push({ name: 'contentType', value: contentType });
    }

    const result = await rag.search(ctx, {
      namespace,
      query,
      ...(filters.length > 0 ? { filters } : {}),
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
