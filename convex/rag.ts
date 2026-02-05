import { components } from './_generated/api';
import { RAG } from '@convex-dev/rag';
import { openai } from '@ai-sdk/openai';

/**
 * Filter types for RAG content
 */
type FilterTypes = {
  projectId: string;
  contentType: string;
  category: string;
  importance: number;
};

/**
 * RAG instance configured with OpenAI embeddings
 *
 * Uses text-embedding-3-small model with 1536 dimensions
 * for efficient semantic search across indexed content.
 *
 * Chunk options are specified when adding content via rag.add():
 * - maxChunkSize: 1000 (recommended)
 * - overlapSize: 100 (recommended)
 */
export const rag = new RAG<FilterTypes>(components.rag, {
  textEmbeddingModel: openai.embedding('text-embedding-3-small'),
  embeddingDimension: 1536,
  filterNames: ['projectId', 'contentType', 'category', 'importance'],
});
