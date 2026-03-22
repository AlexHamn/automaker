/**
 * Convex Indexing Functions
 *
 * Provides actions, mutations, and queries for indexing context and memory
 * files into the RAG system for semantic search.
 */

import { v } from 'convex/values';
import { action, mutation, query, internalMutation } from './_generated/server';
import { internal } from './_generated/api';
import { rag } from './rag';

/**
 * Index a context file into the RAG system
 *
 * Context files are from .automaker/context/ and provide project-specific
 * instructions and documentation for AI agents.
 */
export const indexContextFile = action({
  args: {
    projectId: v.string(),
    filePath: v.string(),
    content: v.string(),
    contentHash: v.string(),
    title: v.optional(v.string()),
    category: v.optional(v.string()),
    importance: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const {
      projectId,
      filePath,
      content,
      contentHash,
      title,
      category = 'general',
      importance = 0.7,
    } = args;

    const namespace = `project:${projectId}`;
    const key = `context:${filePath}`;

    // Add content to RAG with all 4 required filter values
    await rag.add(ctx, {
      namespace,
      key,
      text: content,
      contentHash,
      title: title || filePath,
      importance,
      filterValues: [
        { name: 'projectId', value: projectId },
        { name: 'contentType', value: 'context' },
        { name: 'category', value: category },
        { name: 'importance', value: importance },
      ],
    });

    // Upsert the indexed content record
    await ctx.runMutation(internal.indexing.upsertIndexedContentInternal, {
      projectId,
      filePath,
      contentType: 'context',
      checksum: contentHash,
      title: title || filePath,
      category,
      importance,
      vectorId: key,
    });

    return { success: true, key };
  },
});

/**
 * Index a memory file into the RAG system
 *
 * Memory files are from .automaker/memory/ and contain learnings,
 * patterns, and gotchas from previous agent work.
 */
export const indexMemoryFile = action({
  args: {
    projectId: v.string(),
    filePath: v.string(),
    content: v.string(),
    contentHash: v.string(),
    tags: v.optional(v.array(v.string())),
    importance: v.optional(v.number()),
    summary: v.optional(v.string()),
    category: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const {
      projectId,
      filePath,
      content,
      contentHash,
      tags = [],
      importance = 0.7,
      summary = '',
      category = 'general',
    } = args;

    const namespace = `project:${projectId}`;
    const key = `memory:${filePath}`;

    // Enrich content with metadata header for better embeddings
    const enrichedContent = buildEnrichedContent(content, tags, summary, category);

    // Add content to RAG with all 4 required filter values
    await rag.add(ctx, {
      namespace,
      key,
      text: enrichedContent,
      contentHash,
      title: filePath,
      importance,
      filterValues: [
        { name: 'projectId', value: projectId },
        { name: 'contentType', value: 'memory' },
        { name: 'category', value: category },
        { name: 'importance', value: importance },
      ],
    });

    // Upsert the indexed content record
    await ctx.runMutation(internal.indexing.upsertIndexedContentInternal, {
      projectId,
      filePath,
      contentType: 'memory',
      checksum: contentHash,
      title: filePath,
      category,
      importance,
      vectorId: key,
    });

    return { success: true, key };
  },
});

/**
 * Build enriched content with metadata header for better embeddings
 */
function buildEnrichedContent(
  body: string,
  tags: string[],
  summary: string,
  category: string
): string {
  const parts: string[] = [];

  if (tags.length > 0) {
    parts.push(`Tags: ${tags.join(', ')}`);
  }
  if (summary) {
    parts.push(`Summary: ${summary}`);
  }
  if (category && category !== 'general') {
    parts.push(`Category: ${category}`);
  }

  if (parts.length > 0) {
    return parts.join('\n') + '\n\n' + body;
  }
  return body;
}

/**
 * Internal mutation to upsert indexed content record
 * Called from within actions
 */
export const upsertIndexedContentInternal = internalMutation({
  args: {
    projectId: v.string(),
    filePath: v.string(),
    contentType: v.string(),
    checksum: v.string(),
    title: v.optional(v.string()),
    category: v.optional(v.string()),
    importance: v.optional(v.number()),
    vectorId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { projectId, filePath, contentType, checksum, title, category, importance, vectorId } =
      args;

    // Check if record exists
    const existing = await ctx.db
      .query('indexedContent')
      .withIndex('by_project_and_path', (q) =>
        q.eq('projectId', projectId).eq('filePath', filePath)
      )
      .first();

    const now = Date.now();

    if (existing) {
      // Update existing record
      await ctx.db.patch(existing._id, {
        contentType,
        checksum,
        title,
        category,
        importance,
        vectorId,
        lastIndexed: now,
      });
      return { updated: true, id: existing._id };
    } else {
      // Create new record
      const id = await ctx.db.insert('indexedContent', {
        projectId,
        filePath,
        contentType,
        checksum,
        title,
        category,
        importance,
        vectorId,
        lastIndexed: now,
      });
      return { updated: false, id };
    }
  },
});

/**
 * Public mutation to upsert indexed content (for external calls)
 */
export const upsertIndexedContent = mutation({
  args: {
    projectId: v.string(),
    filePath: v.string(),
    contentType: v.string(),
    checksum: v.string(),
    title: v.optional(v.string()),
    category: v.optional(v.string()),
    importance: v.optional(v.number()),
    vectorId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { projectId, filePath, contentType, checksum, title, category, importance, vectorId } =
      args;

    // Check if record exists
    const existing = await ctx.db
      .query('indexedContent')
      .withIndex('by_project_and_path', (q) =>
        q.eq('projectId', projectId).eq('filePath', filePath)
      )
      .first();

    const now = Date.now();

    if (existing) {
      // Update existing record
      await ctx.db.patch(existing._id, {
        contentType,
        checksum,
        title,
        category,
        importance,
        vectorId,
        lastIndexed: now,
      });
      return { updated: true, id: existing._id };
    } else {
      // Create new record
      const id = await ctx.db.insert('indexedContent', {
        projectId,
        filePath,
        contentType,
        checksum,
        title,
        category,
        importance,
        vectorId,
        lastIndexed: now,
      });
      return { updated: false, id };
    }
  },
});

/**
 * Get indexed content record by project and file path
 *
 * Used to check if a file needs re-indexing by comparing checksums.
 */
export const getIndexedContent = query({
  args: {
    projectId: v.string(),
    filePath: v.string(),
  },
  handler: async (ctx, args) => {
    const { projectId, filePath } = args;

    return await ctx.db
      .query('indexedContent')
      .withIndex('by_project_and_path', (q) =>
        q.eq('projectId', projectId).eq('filePath', filePath)
      )
      .first();
  },
});

/**
 * Index an agent output from a completed feature
 *
 * Agent outputs contain implementation details, decisions, and code changes
 * that can inform future feature implementations via semantic search.
 */
export const indexAgentOutput = action({
  args: {
    projectId: v.string(),
    featureId: v.string(),
    featureTitle: v.string(),
    category: v.string(),
    agentOutput: v.string(),
    contentHash: v.string(),
    wasSuccessful: v.boolean(),
  },
  handler: async (ctx, args) => {
    const {
      projectId,
      featureId,
      featureTitle,
      category,
      agentOutput,
      contentHash,
      wasSuccessful,
    } = args;

    const namespace = `project:${projectId}`;
    const key = `feature:${featureId}`;

    // Higher importance for successful implementations
    const importance = wasSuccessful ? 0.8 : 0.4;

    // Prepend feature metadata for better embeddings
    const enrichedContent = [
      `# Feature: ${featureTitle}`,
      `Category: ${category}`,
      `Status: ${wasSuccessful ? 'Successful' : 'Failed'}`,
      '',
      agentOutput,
    ].join('\n');

    // Add content to RAG with all 4 required filter values
    await rag.add(ctx, {
      namespace,
      key,
      text: enrichedContent,
      contentHash,
      title: featureTitle,
      importance,
      filterValues: [
        { name: 'projectId', value: projectId },
        { name: 'contentType', value: 'agent-output' },
        { name: 'category', value: category },
        { name: 'importance', value: importance },
      ],
    });

    // Upsert the indexed content record
    const filePath = `features/${featureId}/agent-output.md`;
    await ctx.runMutation(internal.indexing.upsertIndexedContentInternal, {
      projectId,
      filePath,
      contentType: 'agent-output',
      checksum: contentHash,
      title: featureTitle,
      category,
      importance,
      vectorId: key,
    });

    return { success: true, key };
  },
});

/**
 * Index a code pattern extracted from a source file
 *
 * Code patterns include exported functions, components, types, and
 * architectural information that helps agents understand the codebase.
 */
export const indexCodePattern = action({
  args: {
    projectId: v.string(),
    filePath: v.string(),
    content: v.string(),
    contentHash: v.string(),
    patternType: v.string(),
    title: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { projectId, filePath, content, contentHash, patternType, title } = args;

    const namespace = `project:${projectId}`;
    const key = `code:${filePath}`;
    const importance = 0.6;

    await rag.add(ctx, {
      namespace,
      key,
      text: content,
      contentHash,
      title: title || filePath,
      importance,
      filterValues: [
        { name: 'projectId', value: projectId },
        { name: 'contentType', value: 'code' },
        { name: 'category', value: patternType },
        { name: 'importance', value: importance },
      ],
    });

    await ctx.runMutation(internal.indexing.upsertIndexedContentInternal, {
      projectId,
      filePath,
      contentType: 'code',
      checksum: contentHash,
      title: title || filePath,
      category: patternType,
      importance,
      vectorId: key,
    });

    return { success: true, key };
  },
});

/**
 * Remove indexed content for a deleted file
 *
 * Removes the tracking record from the indexedContent table.
 * The RAG component will handle cleanup of orphaned vectors.
 */
export const removeIndexedContent = mutation({
  args: {
    projectId: v.string(),
    filePath: v.string(),
  },
  handler: async (ctx, args) => {
    const { projectId, filePath } = args;

    const existing = await ctx.db
      .query('indexedContent')
      .withIndex('by_project_and_path', (q) =>
        q.eq('projectId', projectId).eq('filePath', filePath)
      )
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
      return { removed: true, id: existing._id };
    }

    return { removed: false };
  },
});

/**
 * List all indexed content for a project
 *
 * Returns metadata about all files indexed for the given project.
 */
export const listProjectContent = query({
  args: {
    projectId: v.string(),
  },
  handler: async (ctx, args) => {
    const { projectId } = args;

    return await ctx.db
      .query('indexedContent')
      .withIndex('by_project', (q) => q.eq('projectId', projectId))
      .collect();
  },
});
