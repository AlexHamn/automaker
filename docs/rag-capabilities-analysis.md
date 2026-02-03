# RAG Capabilities Analysis for Automaker

This document analyzes opportunities for implementing Retrieval-Augmented Generation (RAG) in Automaker to enhance AI agent context management and knowledge retrieval.

## Executive Summary

Automaker's existing context/memory systems provide a solid foundation for RAG integration. **We propose using [Convex](https://www.convex.dev/) with the [@convex-dev/rag](https://www.npmjs.com/package/@convex-dev/rag) component** as the implementation platform, providing:

- Real-time reactive database with automatic subscriptions
- Built-in vector search with configurable embeddings
- Namespace isolation for multi-project support
- Chunk context retrieval for surrounding content
- Importance weighting aligned with our existing memory system

The biggest wins will come from:

1. **Semantic search over memory/context files** - Quick win, high value
2. **Indexing agent outputs** - Medium effort, high value for pattern reuse
3. **Continuous codebase intelligence** - Medium effort, high value for better understanding
4. **Event/outcome analysis** - Higher effort, medium value for predictive benefits

---

## Convex RAG Implementation

### Why Convex?

[Convex](https://docs.convex.dev/home) is a reactive backend platform that provides:

| Feature | Benefit for Automaker |
|---------|----------------------|
| **Real-time subscriptions** | UI automatically updates when knowledge base changes |
| **Vector search** | Built-in similarity search up to millions of vectors |
| **TypeScript-native** | Matches Automaker's existing stack |
| **Serverless** | No infrastructure management |
| **Document-relational** | Flexible schema for diverse content types |
| **Self-hostable** | Can run on-premise if needed |

### @convex-dev/rag Component

The [RAG component](https://www.convex.dev/components/rag) provides turnkey retrieval capabilities:

**Core Features**:
- **Automatic chunking**: Splits text into 100-1000 character paragraphs
- **Embedding generation**: Works with any AI SDK embedding model
- **Namespace isolation**: Per-project or per-user search domains
- **Custom filtering**: Index and filter by metadata fields
- **Importance weighting**: 0-1 scores (matches our memory system)
- **Chunk context**: Retrieve surrounding chunks for better context
- **Graceful migrations**: Update content without service disruption

### Installation

```bash
npm install @convex-dev/rag convex @ai-sdk/openai
```

### Configuration

**convex/convex.config.ts**:
```typescript
import { defineApp } from "convex/server";
import rag from "@convex-dev/rag/convex.config.js";

const app = defineApp();
app.use(rag);
export default app;
```

**convex/rag.ts** - RAG instance initialization:
```typescript
import { components } from "./_generated/api";
import { RAG } from "@convex-dev/rag";
import { openai } from "@ai-sdk/openai";

// Define filter types for Automaker content
type AutomakerFilters = {
  contentType: "context" | "memory" | "feature" | "agent-output" | "code";
  category: string;
  projectId: string;
  importance: number;
  // Composite filter for AND queries
  typeAndCategory: { contentType: string; category: string };
};

export const rag = new RAG<AutomakerFilters>(components.rag, {
  textEmbeddingModel: openai.embedding("text-embedding-3-small"),
  embeddingDimension: 1536,
  filterNames: ["contentType", "category", "projectId", "importance", "typeAndCategory"],
});
```

### Schema Design for Automaker

```typescript
// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Track indexed content metadata
  indexedContent: defineTable({
    projectId: v.string(),
    contentType: v.union(
      v.literal("context"),
      v.literal("memory"),
      v.literal("feature"),
      v.literal("agent-output"),
      v.literal("code")
    ),
    sourcePath: v.string(),           // Original file path
    title: v.optional(v.string()),
    category: v.optional(v.string()),
    importance: v.number(),           // 0-1 score
    lastIndexed: v.number(),          // Timestamp
    checksum: v.string(),             // For change detection
    metadata: v.optional(v.any()),    // Additional data
  })
    .index("by_project", ["projectId"])
    .index("by_project_type", ["projectId", "contentType"])
    .index("by_source", ["sourcePath"]),

  // Track indexing jobs
  indexingJobs: defineTable({
    projectId: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed")
    ),
    contentType: v.string(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    itemsProcessed: v.number(),
    errors: v.optional(v.array(v.string())),
  }).index("by_project_status", ["projectId", "status"]),
});
```

### Content Indexing Actions

**convex/indexing.ts** - Content ingestion:
```typescript
import { action, internalAction } from "./_generated/server";
import { v } from "convex/values";
import { rag } from "./rag";

// Index a context file
export const indexContextFile = action({
  args: {
    projectId: v.string(),
    filePath: v.string(),
    content: v.string(),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const namespace = `project:${args.projectId}`;

    await rag.add(ctx, {
      namespace,
      key: `context:${args.filePath}`,  // Enables replacement on re-index
      text: args.content,
      title: args.title,
      filterValues: [
        { name: "contentType", value: "context" },
        { name: "projectId", value: args.projectId },
      ],
    });
  },
});

// Index a memory file with importance weighting
export const indexMemoryFile = action({
  args: {
    projectId: v.string(),
    filePath: v.string(),
    content: v.string(),
    tags: v.array(v.string()),
    importance: v.number(),
    summary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const namespace = `project:${args.projectId}`;

    // Prepend tags and summary for better embedding
    const enrichedContent = [
      args.summary ? `Summary: ${args.summary}` : "",
      args.tags.length ? `Tags: ${args.tags.join(", ")}` : "",
      "",
      args.content,
    ].filter(Boolean).join("\n");

    await rag.add(ctx, {
      namespace,
      key: `memory:${args.filePath}`,
      text: enrichedContent,
      importance: args.importance,  // 0-1 weighting
      filterValues: [
        { name: "contentType", value: "memory" },
        { name: "projectId", value: args.projectId },
        { name: "importance", value: args.importance },
      ],
    });
  },
});

// Index agent output from completed features
export const indexAgentOutput = action({
  args: {
    projectId: v.string(),
    featureId: v.string(),
    featureTitle: v.string(),
    category: v.string(),
    agentOutput: v.string(),
    wasSuccessful: v.boolean(),
  },
  handler: async (ctx, args) => {
    const namespace = `project:${args.projectId}`;

    // Higher importance for successful implementations
    const importance = args.wasSuccessful ? 0.8 : 0.4;

    // Prepend feature context for better retrieval
    const enrichedContent = [
      `# Feature: ${args.featureTitle}`,
      `Category: ${args.category}`,
      `Status: ${args.wasSuccessful ? "Successful" : "Failed"}`,
      "",
      args.agentOutput,
    ].join("\n");

    await rag.add(ctx, {
      namespace,
      key: `feature:${args.featureId}`,
      text: enrichedContent,
      importance,
      filterValues: [
        { name: "contentType", value: "agent-output" },
        { name: "category", value: args.category },
        { name: "projectId", value: args.projectId },
        { name: "typeAndCategory", value: {
          contentType: "agent-output",
          category: args.category
        }},
      ],
    });
  },
});
```

### Search Actions

**convex/search.ts** - Retrieval queries:
```typescript
import { action } from "./_generated/server";
import { v } from "convex/values";
import { rag } from "./rag";

// Search for relevant context given a feature description
export const searchForFeatureContext = action({
  args: {
    projectId: v.string(),
    featureTitle: v.string(),
    featureDescription: v.string(),
    category: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const namespace = `project:${args.projectId}`;
    const query = `${args.featureTitle}\n${args.featureDescription}`;

    // Build filters
    const filters: Array<{ name: string; value: any }> = [
      { name: "projectId", value: args.projectId },
    ];

    // Optionally filter by category
    if (args.category) {
      filters.push({ name: "category", value: args.category });
    }

    const { results, text, entries, usage } = await rag.search(ctx, {
      namespace,
      query,
      limit: args.limit ?? 10,
      vectorScoreThreshold: 0.5,  // Minimum relevance
      chunkContext: { before: 1, after: 1 },  // Include surrounding chunks
      filters,
    });

    return {
      formattedContext: text,  // Ready for prompt injection
      results: results.map(r => ({
        content: r.text,
        score: r.score,
        source: entries.find(e => e._id === r.entryId)?.key,
      })),
      tokenUsage: usage,
    };
  },
});

// Search for similar past implementations
export const searchSimilarImplementations = action({
  args: {
    projectId: v.string(),
    description: v.string(),
    category: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const namespace = `project:${args.projectId}`;

    const filters = [
      { name: "contentType", value: "agent-output" },
      { name: "projectId", value: args.projectId },
    ];

    if (args.category) {
      filters.push({ name: "category", value: args.category });
    }

    const { results, text } = await rag.search(ctx, {
      namespace,
      query: args.description,
      limit: 5,
      vectorScoreThreshold: 0.6,  // Higher threshold for implementations
      chunkContext: { before: 2, after: 2 },
      filters,
    });

    return { formattedContext: text, matchCount: results.length };
  },
});

// Search memory files for gotchas and learnings
export const searchMemoryForGotchas = action({
  args: {
    projectId: v.string(),
    taskDescription: v.string(),
  },
  handler: async (ctx, args) => {
    const namespace = `project:${args.projectId}`;

    const { results, text } = await rag.search(ctx, {
      namespace,
      query: `potential issues problems gotchas: ${args.taskDescription}`,
      limit: 5,
      vectorScoreThreshold: 0.5,
      filters: [
        { name: "contentType", value: "memory" },
        { name: "projectId", value: args.projectId },
      ],
    });

    return { warnings: text, matchCount: results.length };
  },
});
```

### Integration with Automaker Server

**apps/server/src/services/convex-rag-service.ts**:
```typescript
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";

export class ConvexRAGService {
  private client: ConvexHttpClient;

  constructor(convexUrl: string) {
    this.client = new ConvexHttpClient(convexUrl);
  }

  // Index all context files for a project
  async indexContextFiles(projectId: string, contextDir: string): Promise<void> {
    const files = await this.loadContextFiles(contextDir);

    for (const file of files) {
      await this.client.action(api.indexing.indexContextFile, {
        projectId,
        filePath: file.path,
        content: file.content,
        title: file.title,
        description: file.description,
      });
    }
  }

  // Index memory files with importance scores
  async indexMemoryFiles(projectId: string, memoryDir: string): Promise<void> {
    const files = await this.loadMemoryFiles(memoryDir);

    for (const file of files) {
      await this.client.action(api.indexing.indexMemoryFile, {
        projectId,
        filePath: file.path,
        content: file.content,
        tags: file.tags,
        importance: file.importance,
        summary: file.summary,
      });
    }
  }

  // Index completed feature output
  async indexFeatureOutput(
    projectId: string,
    featureId: string,
    featureTitle: string,
    category: string,
    agentOutput: string,
    wasSuccessful: boolean
  ): Promise<void> {
    await this.client.action(api.indexing.indexAgentOutput, {
      projectId,
      featureId,
      featureTitle,
      category,
      agentOutput,
      wasSuccessful,
    });
  }

  // Get relevant context for a feature
  async getFeatureContext(
    projectId: string,
    featureTitle: string,
    featureDescription: string,
    category?: string
  ): Promise<{ context: string; sources: string[] }> {
    const result = await this.client.action(api.search.searchForFeatureContext, {
      projectId,
      featureTitle,
      featureDescription,
      category,
      limit: 10,
    });

    return {
      context: result.formattedContext,
      sources: result.results.map(r => r.source).filter(Boolean),
    };
  }

  // Find similar past implementations
  async findSimilarImplementations(
    projectId: string,
    description: string,
    category?: string
  ): Promise<string> {
    const result = await this.client.action(api.search.searchSimilarImplementations, {
      projectId,
      description,
      category,
    });

    return result.formattedContext;
  }

  // Search for potential gotchas
  async searchGotchas(projectId: string, taskDescription: string): Promise<string> {
    const result = await this.client.action(api.search.searchMemoryForGotchas, {
      projectId,
      taskDescription,
    });

    return result.warnings;
  }

  private async loadContextFiles(dir: string) { /* ... */ }
  private async loadMemoryFiles(dir: string) { /* ... */ }
}
```

### Enhanced Context Loader

**libs/utils/src/context-loader.ts** (enhanced):
```typescript
import { ConvexRAGService } from '@automaker/server/services/convex-rag-service';

export async function loadContextFilesWithRAG(
  projectDir: string,
  options?: {
    convexUrl?: string;
    projectId?: string;
    featureTitle?: string;
    featureDescription?: string;
    category?: string;
    fallbackToFullLoad?: boolean;
  }
): Promise<string> {
  // If RAG is configured, use semantic search
  if (options?.convexUrl && options?.projectId && options?.featureTitle) {
    const ragService = new ConvexRAGService(options.convexUrl);

    try {
      const { context, sources } = await ragService.getFeatureContext(
        options.projectId,
        options.featureTitle,
        options.featureDescription ?? "",
        options.category
      );

      // Include source attribution
      const attribution = sources.length
        ? `\n\n<!-- Retrieved from: ${sources.join(", ")} -->`
        : "";

      return context + attribution;
    } catch (error) {
      if (options.fallbackToFullLoad) {
        // Fall back to loading all files
        return loadContextFiles(projectDir);
      }
      throw error;
    }
  }

  // Default: load all context files
  return loadContextFiles(projectDir);
}
```

### Automatic Indexing on Feature Completion

**apps/server/src/services/agent-service.ts** (hook):
```typescript
// After feature execution completes
async function onFeatureComplete(
  projectId: string,
  feature: Feature,
  agentOutput: string,
  wasSuccessful: boolean
): Promise<void> {
  // Index the agent output for future retrieval
  if (convexRAGService) {
    await convexRAGService.indexFeatureOutput(
      projectId,
      feature.id,
      feature.title,
      feature.category ?? "uncategorized",
      agentOutput,
      wasSuccessful
    );
  }
}
```

### Real-Time Dashboard Integration

Convex's reactive subscriptions enable real-time UI updates:

```typescript
// apps/ui/src/hooks/useKnowledgeBase.ts
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

export function useKnowledgeBaseStats(projectId: string) {
  // Automatically updates when content is indexed
  return useQuery(api.stats.getIndexStats, { projectId });
}

export function useRecentIndexedContent(projectId: string, limit: number = 10) {
  return useQuery(api.stats.getRecentlyIndexed, { projectId, limit });
}
```

### Convex vs Alternatives

| Feature | Convex RAG | Pinecone | Chroma | pgvector |
|---------|------------|----------|--------|----------|
| **Real-time updates** | Native | Manual sync | Manual sync | Manual sync |
| **TypeScript-native** | Yes | SDK | SDK | ORM |
| **Managed hosting** | Yes | Yes | Cloud option | Self-host |
| **Self-hostable** | Yes | No | Yes | Yes |
| **Built-in chunking** | Yes | No | No | No |
| **Importance weighting** | Yes | Metadata | Metadata | Metadata |
| **Chunk context** | Built-in | Manual | Manual | Manual |
| **Cost (small-med)** | Free tier | Paid | Free | DB cost |

### Deployment Options

**Option 1: Convex Cloud (Recommended for start)**
- Free tier: 100K function calls/month
- No infrastructure management
- Automatic scaling

**Option 2: Self-Hosted Convex**
- Full control over data
- Works with Postgres, SQLite, Neon
- Docker deployment available

```bash
# Self-hosted with Docker
docker run -d \
  -e DATABASE_URL=postgres://... \
  -p 3210:3210 \
  convex/convex-backend
```

---

## Current Context Management Systems

### 1. Context Files System (`.automaker/context/`)

**Location**: `libs/utils/src/context-loader.ts`

**Current Capabilities**:
- Loads project-specific rules from `.automaker/context/` directory (*.md, *.txt files)
- Stores metadata in `context-metadata.json` with descriptions for each file
- Automatically prepended to all agent prompts as system instructions
- All context files formatted into a single "Project Context Files" section

**Limitation**: Context is loaded as a monolithic blob without intelligent filtering or ranking based on task relevance.

### 2. Memory System (`.automaker/memory/`)

**Location**: `libs/utils/src/memory-loader.ts`

**Current Capabilities**:
- Files with YAML frontmatter containing:
  - `tags[]` - Feature keywords (weighted at 3x)
  - `relevantTo[]` - Related terms (weighted at 2x)
  - `summary` - File description (weighted at 1x)
  - `importance` - Numeric score 0-1
  - `usageStats` - Tracking loads, references, successful features

**Current Smart Selection**:
- Extracts task terms from feature title/description
- Matches terms against tags, relevantTo, summary, filename
- Prioritizes high-importance files (>=0.9)
- Always includes `gotchas.md`
- Loads up to 5 files maximum
- Tracks usage statistics for learning which files are helpful

**Limitation**: Scoring uses basic pattern matching without semantic understanding.

### 3. Project Analysis

**Location**: `apps/server/src/services/ideation-service.ts`

**Current Capabilities**:
- Gathers project structure (routes, components, services, framework, dependencies)
- Generates suggestions using Claude
- Caches result in `.automaker/` as structured JSON

**Limitation**: Not continuously indexed or retrieval-optimized; analysis is a snapshot.

### 4. Session/Conversation History

**Location**: `apps/server/src/services/agent-service.ts`

**Current Storage**:
- Per-session message history stored in memory during execution
- Persisted in `.automaker/agent-sessions/` directory
- Session metadata in `sessions-metadata.json`
- Messages include role, content, timestamp, and images
- Claude SDK session IDs enable conversation continuity

**Limitation**: No cross-session search or knowledge extraction.

### 5. Feature History & Execution Records

**Location**: `.automaker/features/{featureId}/`

**Stored Data**:
- Feature title, description, category, status, priority
- `descriptionHistory` - Tracks description changes with timestamps and source
- `agent-output.md` - Raw agent execution output
- Images and text file attachments
- Plan specifications with task breakdowns

**Limitation**: Feature execution logs are stored but not indexed for knowledge retrieval.

---

## Current Limitations

| Limitation | Description | Impact |
|------------|-------------|--------|
| **Static Context Loading** | All context files loaded regardless of relevance | Prompt bloat, irrelevant context |
| **No Codebase Indexing** | Agents scan codebase on-demand | Repeated searches, slower execution |
| **Scattered Learning Records** | Decisions in separate memory files | No semantic linking between learnings |
| **Lost Conversation Context** | Sessions not mined for insights | No cross-session knowledge transfer |
| **Analysis Underutilization** | Project analysis cached but not used for guidance | Missed opportunities for context selection |
| **Prompt Overload Risk** | Growing context files bloat prompts | Token inefficiency, context window limits |

---

## RAG Use Cases

### High-Value Use Cases

#### 1. Smart Context Selection for Features

**Problem**: Agents receive all context files equally, regardless of feature type.

**RAG Solution**:
- Index context files with semantic embeddings
- Query: "This feature involves authentication and database schema changes"
- Return: Only relevant architectural docs, security guidelines, database patterns

**Impact**: Reduce context bloat by 40-60%, improve decision-making precision.

#### 2. Pattern Recognition & Code Reuse

**Problem**: Agents often rewrite similar implementations across features.

**RAG Solution**:
- Index successful feature implementations and code patterns
- Query: "Show me similar payment processing implementations"
- Return: Previous successful code snippets, patterns, gotchas

**Impact**: 30-50% faster implementation, fewer bugs, better consistency.

#### 3. Learned Decision Discovery

**Problem**: Developers learn through features but knowledge isn't discoverable.

**RAG Solution**:
- Extract decisions from agent outputs and memory files
- Create semantic index of "We tried X but it failed because Y"
- Query: "What caused failures in async code previously?"

**Impact**: Avoid repeating past mistakes, build tribal knowledge.

#### 4. Architecture Understanding on Demand

**Problem**: Project analysis is a cached snapshot; doesn't evolve with codebase.

**RAG Solution**:
- Continuously index codebase structure, dependencies, relationships
- Query: "What components interact with the user authentication module?"
- Return: Dependency graph, impacted files, potential side effects

**Impact**: Better planning, reduced regressions, architectural awareness.

### Medium-Value Use Cases

#### 5. Cross-Session Knowledge Transfer

**Problem**: Each agent session starts fresh, unaware of previous solutions.

**RAG Solution**:
- Index conversation histories and successful solution approaches
- Query: "How did we implement real-time notifications in the past?"

**Impact**: Faster agent onboarding, consistent strategies.

#### 6. Event-Based Learning Extraction

**Problem**: Event history logged but not mined for insights.

**RAG Solution**:
- Index events with extracted insights (success/failure patterns)
- Query: "Which features tend to fail in verification phase?"

**Impact**: Predictive analysis, proactive issue prevention.

#### 7. Dynamic Test Guidance

**Problem**: Agents don't know what test patterns worked before.

**RAG Solution**:
- Index Playwright tests and verification approaches by feature type
- Query: "How should I test multi-step form submissions?"

**Impact**: Better test coverage, faster verification.

---

## Content Types to Index

### High Priority

| Content Type | Location | Semantic Use Case |
|--------------|----------|-------------------|
| **Agent Outputs** | `.automaker/features/{id}/agent-output.md` | "How do we implement X pattern?" |
| **Context Files** | `.automaker/context/*.md` | "What are the requirements for Y?" |
| **Memory Files** | `.automaker/memory/*.md` | "What failed when we tried Z?" |
| **Feature Specifications** | Feature plan specs with tasks | "What features are similar to this one?" |

### Medium Priority

| Content Type | Location | Semantic Use Case |
|--------------|----------|-------------------|
| **Codebase Structure** | Source files, docstrings | Architecture patterns, dependencies |
| **Event History** | Aggregated event logs | Success/failure patterns |
| **Test Files** | Test implementations | "How do we test this pattern?" |

### Lower Priority

| Content Type | Location | Semantic Use Case |
|--------------|----------|-------------------|
| **Conversation Logs** | Agent/human chat histories | Contextual but noisier signal |
| **Git Commits** | Commit messages | "How did we solve this before?" |

---

## Integration Points

### 1. Context Loader Enhancement

**File**: `libs/utils/src/context-loader.ts`

```typescript
// Current
export async function loadContextFiles(projectDir: string): Promise<string>

// Proposed RAG Enhancement
export async function loadContextFiles(
  projectDir: string,
  options?: {
    query?: string;           // Natural language task context
    featureType?: string;     // Category for filtering
    topK?: number;            // Max files to return
    threshold?: number;       // Minimum relevance score
  }
): Promise<string>
```

### 2. Memory System Enhancement

**File**: `libs/utils/src/memory-loader.ts`

```typescript
// Current: Term matching + importance scoring
// Proposed: Add semantic similarity search

interface MemorySearchOptions {
  query: string;
  semanticWeight: number;     // 0-1, balance vs keyword matching
  minScore: number;           // Relevance threshold
}
```

### 3. Feature Loader Enhancement

**File**: `apps/server/src/services/feature-loader.ts`

```typescript
// Proposed: Enable similarity queries
async function findSimilarFeatures(
  query: string,
  topK: number
): Promise<Feature[]>
```

### 4. Agent Service Enhancement

**File**: `apps/server/src/services/agent-service.ts`

```typescript
// Proposed: Pre-populate system prompt with retrieved context
interface AgentContextOptions {
  retrieveRelevantContext: boolean;
  contextQuery?: string;
  maxContextTokens?: number;
}
```

---

## Storage Architecture

### With Convex (Recommended)

Convex manages all vector storage and indexing. Local tracking is minimal:

```
.automaker/
├── convex-sync/
│   ├── last-sync.json              # Timestamp of last index sync
│   └── checksums.json              # File checksums for change detection
```

**Convex Tables** (managed by Convex cloud or self-hosted):
```
rag_entries          # RAG component's chunk storage
rag_chunks           # Embedded text chunks
indexedContent       # Our metadata tracking table
indexingJobs         # Background job status
```

### Namespace Strategy

```
project:{projectId}              # Per-project isolation
  ├── context:{filePath}         # Context files
  ├── memory:{filePath}          # Memory files
  ├── feature:{featureId}        # Feature outputs
  └── code:{filePath}            # Code patterns (Phase 3)
```

### Legacy Local Storage (Fallback)

If Convex is unavailable, fall back to local JSON storage:

```
.automaker/
├── knowledge-index/
│   ├── embeddings/
│   │   ├── context-files.json      # File path → embedding
│   │   ├── memory-files.json       # File path → embedding
│   │   ├── feature-outputs.json    # Feature ID → embedding snippets
│   │   └── codebase-patterns.json  # Pattern ID → embedding
│   ├── metadata/
│   │   ├── indexing-timestamp      # When last indexed
│   │   └── version                 # Index schema version
│   └── index-manifest.json         # Overall index metadata
```

---

## Query Interface Design (Convex)

### Convex RAG Search Response

```typescript
// Response from rag.search()
interface ConvexSearchResponse {
  results: Array<{
    text: string;           // Chunk content
    score: number;          // Similarity score (-1 to 1)
    entryId: string;        // Reference to entry
    order: {
      start: number;        // Chunk position
      end: number;
    };
  }>;
  text: string;             // Formatted context string (ready for prompt)
  entries: Array<{
    _id: string;
    key: string;            // e.g., "context:/path/to/file.md"
    title?: string;
  }>;
  usage: {
    embeddingTokens: number;
  };
}
```

### Automaker Service Interface

```typescript
// apps/server/src/services/convex-rag-service.ts

interface FeatureContextRequest {
  projectId: string;
  featureTitle: string;
  featureDescription: string;
  category?: string;
  limit?: number;
  scoreThreshold?: number;
}

interface FeatureContextResponse {
  context: string;                  // Formatted for prompt injection
  sources: string[];                // Attribution list
  tokenUsage: number;               // Embedding tokens used
}

interface ConvexRAGService {
  // Indexing
  indexContextFiles(projectId: string, contextDir: string): Promise<void>;
  indexMemoryFiles(projectId: string, memoryDir: string): Promise<void>;
  indexFeatureOutput(
    projectId: string,
    featureId: string,
    featureTitle: string,
    category: string,
    agentOutput: string,
    wasSuccessful: boolean
  ): Promise<void>;

  // Search
  getFeatureContext(request: FeatureContextRequest): Promise<FeatureContextResponse>;
  findSimilarImplementations(projectId: string, description: string, category?: string): Promise<string>;
  searchGotchas(projectId: string, taskDescription: string): Promise<string>;

  // Management
  reindexProject(projectId: string): Promise<void>;
  getIndexStats(projectId: string): Promise<IndexStats>;
}
```

### Filter Types

```typescript
// Convex filter configuration for Automaker
type AutomakerFilters = {
  // Single-value filters (OR within same filter)
  contentType: "context" | "memory" | "feature" | "agent-output" | "code";
  category: string;
  projectId: string;

  // Range filter
  importance: number;  // 0-1

  // Composite filter (AND logic)
  typeAndCategory: {
    contentType: string;
    category: string;
  };
};
```

---

## Implementation Phases (Convex)

### Phase 1: Foundation & Context Files

**Goal**: Set up Convex infrastructure and index memory/context files.

**Tasks**:
1. **Convex Setup**
   - Install `@convex-dev/rag`, `convex`, `@ai-sdk/openai`
   - Configure `convex/convex.config.ts` with RAG component
   - Set up schema in `convex/schema.ts`
   - Initialize RAG instance with OpenAI embeddings (1536 dimensions)

2. **Indexing Infrastructure**
   - Create `indexContextFile` and `indexMemoryFile` actions
   - Implement checksum-based change detection
   - Add background indexing job management
   - Build sync command: `npm run rag:sync`

3. **Search Integration**
   - Create `ConvexRAGService` in server
   - Enhance `loadContextFiles()` with RAG option
   - Implement `searchForFeatureContext` action
   - Add fallback to full file load when Convex unavailable

4. **Environment Configuration**
   - Add `CONVEX_URL` and `OPENAI_API_KEY` env vars
   - Configure per-project namespace isolation
   - Set up Convex dashboard access

**Deliverables**:
- `convex/` directory with schema, RAG config, indexing actions
- `ConvexRAGService` class in server
- Enhanced context loader with RAG support
- CLI command for manual re-indexing

**Expected Impact**: 20-30% better context relevance, reduced prompt size.

### Phase 2: Feature Output Indexing

**Goal**: Index agent outputs for pattern discovery and reuse.

**Tasks**:
1. **Automatic Indexing Hook**
   - Add `onFeatureComplete` hook in `AgentService`
   - Index successful features with importance 0.8
   - Index failed features with importance 0.4 (learn from failures)
   - Include feature title, category, and status in embeddings

2. **Search for Similar Implementations**
   - Create `searchSimilarImplementations` action
   - Add category-based filtering
   - Implement chunk context (before: 2, after: 2)
   - Build "similar features" UI component

3. **Gotcha Detection**
   - Create `searchMemoryForGotchas` action
   - Pre-execution warning system
   - Surface past failures related to current task

4. **Backfill Existing Features**
   - Create migration script for existing `.automaker/features/`
   - Batch process agent outputs
   - Track indexing progress in UI

**Deliverables**:
- Automatic feature output indexing on completion
- Similar implementation search in feature planning
- Pre-execution gotcha warnings
- Backfill migration script

**Expected Impact**: 25-35% fewer tool calls, faster implementations.

### Phase 3: Codebase Intelligence

**Goal**: Continuous indexing of project structure and patterns.

**Tasks**:
1. **Code Pattern Indexing**
   - Parse codebase for key patterns (routes, components, services)
   - Extract function signatures and docstrings
   - Index architectural decisions from comments
   - Use AST parsing for structured extraction

2. **Dependency Awareness**
   - Track file relationships and imports
   - Index package.json dependencies
   - Surface breaking change risks

3. **Dynamic Context Injection**
   - Detect files being modified in feature
   - Auto-retrieve related code context
   - Inject architectural constraints

4. **Incremental Indexing**
   - Watch for file changes via Convex functions
   - Re-index modified files automatically
   - Prune deleted content from index

**Deliverables**:
- Codebase pattern indexing
- Dependency-aware context retrieval
- File-change triggered re-indexing
- Architecture constraint injection

**Expected Impact**: 15-25% improvement in code quality, fewer integration issues.

### Phase 4: Cross-Feature Learning

**Goal**: Mine historical data for predictive insights.

**Tasks**:
1. **Event Pattern Analysis**
   - Index feature lifecycle events
   - Track success/failure patterns by category
   - Identify common blockers

2. **Knowledge Extraction**
   - Parse agent conversations for decisions
   - Extract "lessons learned" automatically
   - Build decision rationale index

3. **Predictive Insights**
   - Risk scoring for new features
   - Estimated complexity based on similar features
   - Recommended approaches from history

4. **Knowledge Base UI**
   - Browse indexed content
   - Search across all content types
   - Manual knowledge entry

**Deliverables**:
- Event pattern analytics
- Automated knowledge extraction
- Risk scoring for features
- Knowledge base management UI

**Expected Impact**: Proactive issue prevention, institutional knowledge capture.

---

## Cost Considerations

### Convex Pricing

| Tier | Function Calls | Database | Vector Storage | Cost |
|------|---------------|----------|----------------|------|
| **Free** | 100K/month | 512MB | Included | $0 |
| **Starter** | 1M/month | 2GB | Included | $25/month |
| **Professional** | 10M/month | 10GB | Included | $100/month |
| **Self-Hosted** | Unlimited | Your infra | Your infra | Infra cost |

### OpenAI Embedding Costs

| Model | Dimensions | Cost per 1M tokens |
|-------|------------|-------------------|
| `text-embedding-3-small` | 1536 | $0.02 |
| `text-embedding-3-large` | 3072 | $0.13 |
| `text-embedding-ada-002` | 1536 | $0.10 |

**Recommendation**: Use `text-embedding-3-small` for best cost/quality balance.

### Estimated Costs by Project Size

| Project Size | Initial Index | Per Feature | Monthly Total |
|--------------|---------------|-------------|---------------|
| Small (50 files) | $0.50-1 | $0.01 | $5-10 |
| Medium (200 files) | $2-5 | $0.02 | $15-30 |
| Large (1000 files) | $10-20 | $0.05 | $50-100 |

### Optimization Strategies

1. **Convex Free Tier**: Start with free tier (100K calls/month sufficient for most projects)
2. **Incremental Indexing**: Only re-embed changed files using checksum detection
3. **Chunk Deduplication**: Avoid re-embedding identical chunks
4. **Token Budgets**: Limit retrieved context to ~2000 tokens per query
5. **Self-Host for Scale**: Move to self-hosted Convex for high-volume projects

---

## Success Metrics

| Metric | Current Baseline | Target |
|--------|------------------|--------|
| Average feature completion time | Baseline | -20% |
| Tool calls per feature | Baseline | -40% |
| Bug/rework rate | Baseline | -25% |
| Duplicate implementation patterns | Baseline | -50% |
| New learnings documented per feature | Baseline | +100% |
| Pre-execution gotcha matches | 0 | +80% |

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| **Token Efficiency** - Prompts grow too large | Use `vectorScoreThreshold` (0.5+), limit to ~2000 tokens |
| **Staleness** - Embeddings become outdated | Checksum-based change detection, incremental re-indexing |
| **False Positives** - Irrelevant results | Convex filter fields for category/type constraints |
| **Cost** - Embedding generation expenses | Free tier (100K calls), incremental updates only |
| **Index Growth** - Knowledge base becomes unwieldy | Namespace isolation, importance-based pruning |
| **Privacy** - Embeddings expose project details | Self-hosted Convex option, credential filtering before indexing |
| **Convex Dependency** - Single vendor lock-in | Implement fallback to local file loading |
| **Latency** - Search adds to feature start time | Cache common queries, async pre-warming |
| **API Limits** - Rate limiting on embeddings | Batch embedding generation, queue during indexing |

---

## Recommendations

### Pre-Implementation (Now)

1. **Set up Convex account** - Create project at [convex.dev](https://www.convex.dev/)
2. **Configure OpenAI API key** - For `text-embedding-3-small` model
3. **Add env vars** - `CONVEX_URL`, `OPENAI_API_KEY` to Automaker config
4. **Document existing memory files** - Ensure tags and importance scores are accurate

### Phase 1 Priorities

1. **Start with memory files** - Smallest corpus, highest value, existing importance scores
2. **Use OpenAI embeddings** - `text-embedding-3-small` is cost-effective and high quality
3. **Leverage Convex RAG chunking** - Default 100-1000 char chunks work well
4. **Implement graceful fallback** - Load all files when Convex unavailable

### Phase 2 Priorities

1. **Auto-index on feature completion** - Hook into AgentService lifecycle
2. **Category-based filtering** - Use Convex filter fields for targeted retrieval
3. **Chunk context retrieval** - Use `{ before: 2, after: 1 }` for surrounding context
4. **Track retrieval usage** - Log which retrieved content was actually used

### Phase 3 Priorities

1. **Incremental codebase indexing** - Watch for file changes, re-index selectively
2. **AST-based extraction** - Use TypeScript compiler API for structured parsing
3. **Dependency graph indexing** - Track imports and relationships
4. **Convex subscriptions for UI** - Real-time knowledge base updates in dashboard

### Long-Term Considerations

1. **Self-hosted Convex** - For large teams or data sovereignty requirements
2. **Cross-project knowledge sharing** - Shared namespace for common patterns
3. **Embedding model upgrades** - Easy to switch models with Convex RAG
4. **Active learning** - Track which retrievals led to successful features

---

## Conclusion

RAG integration in Automaker using **Convex and @convex-dev/rag** presents a significant opportunity to:

1. **Reduce agent execution time** by providing pre-indexed, relevant context
2. **Improve code quality** through pattern reuse and gotcha prevention
3. **Capture institutional knowledge** from agent executions
4. **Enable predictive insights** from historical outcomes
5. **Provide real-time UI updates** via Convex's reactive subscriptions

### Why Convex is the Right Choice

- **TypeScript-native**: Matches Automaker's existing stack perfectly
- **Built-in RAG component**: Chunking, embeddings, and search out of the box
- **Importance weighting**: Aligns with existing memory file importance scores
- **Namespace isolation**: Natural fit for multi-project Automaker usage
- **Real-time subscriptions**: Knowledge base updates instantly reflected in UI
- **Free tier sufficient**: 100K function calls/month covers most usage
- **Self-hostable**: Option for data sovereignty when needed

### Next Steps

1. Create Convex project and configure RAG component
2. Implement Phase 1: Index context and memory files
3. Enhance context loader with semantic search
4. Add automatic indexing hook for completed features
5. Build knowledge base UI with Convex subscriptions

The modular architecture with existing context-loader and memory-loader utilities makes this enhancement straightforward to implement incrementally. Starting with semantic search over memory files (Phase 1) provides the fastest path to value with minimal risk.

---

## References

- [Convex Documentation](https://docs.convex.dev/home)
- [Convex RAG Component](https://www.convex.dev/components/rag)
- [RAG with Agent Component](https://docs.convex.dev/agents/rag)
- [Convex Vector Search](https://docs.convex.dev/search/vector-search)
- [@convex-dev/rag npm package](https://www.npmjs.com/package/@convex-dev/rag)
- [Convex RAG GitHub Repository](https://github.com/get-convex/rag)
- [The Magic of Embeddings (Convex Blog)](https://stack.convex.dev/the-magic-of-embeddings)
- [Retrieval-Augmented Generation: Convex can do that](https://www.convex.dev/can-do/rag)
