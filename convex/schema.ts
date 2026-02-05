import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  /**
   * Track indexed files with metadata for RAG retrieval
   */
  indexedContent: defineTable({
    projectId: v.string(),
    filePath: v.string(),
    contentType: v.string(), // "code", "documentation", "config", "test"
    checksum: v.string(),
    title: v.optional(v.string()),
    category: v.optional(v.string()),
    importance: v.optional(v.number()), // 0-1 scale
    lastIndexed: v.number(),
    vectorId: v.optional(v.string()), // Key referencing the RAG component document
  })
    .index('by_project', ['projectId'])
    .index('by_project_and_path', ['projectId', 'filePath'])
    .index('by_content_type', ['contentType']),

  /**
   * Background job management for indexing operations
   */
  indexingJobs: defineTable({
    projectId: v.string(),
    jobType: v.string(), // "full_index", "incremental", "single_file"
    status: v.string(), // "pending", "running", "completed", "failed"
    filePath: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    attempts: v.number(),
    createdAt: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  })
    .index('by_project', ['projectId'])
    .index('by_status', ['status']),
});
