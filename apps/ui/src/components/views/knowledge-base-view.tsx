import { useState } from 'react';
import {
  Database,
  RefreshCw,
  Search,
  FileText,
  Brain,
  Bot,
  Code,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAppStore } from '@/store/app-store';
import {
  useKnowledgeBaseStatus,
  useKnowledgeBaseSearch,
  useIndexProject,
  useIndexCode,
} from '@/hooks/queries';
import type { KBFile } from '@/hooks/queries';

const CONTENT_TYPE_LABELS: Record<string, { label: string; icon: typeof FileText }> = {
  context: { label: 'Context', icon: FileText },
  memory: { label: 'Memory', icon: Brain },
  'agent-output': { label: 'Agent Output', icon: Bot },
  code: { label: 'Code', icon: Code },
};

function ContentTypeBadge({ type }: { type: string }) {
  const config = CONTENT_TYPE_LABELS[type] || { label: type, icon: FileText };
  const Icon = config.icon;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      <Icon className="h-2.5 w-2.5" />
      {config.label}
    </span>
  );
}

function StatusIndicator({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      {ok ? (
        <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
      ) : (
        <XCircle className="h-3.5 w-3.5 text-red-500" />
      )}
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}

export function KnowledgeBaseView() {
  const projectPath = useAppStore((s) => s.currentProject?.path);
  const { data: status, isLoading: statusLoading } = useKnowledgeBaseStatus(projectPath);
  const indexMutation = useIndexProject(projectPath);
  const indexCodeMutation = useIndexCode(projectPath);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchContentType, setSearchContentType] = useState<string | undefined>(undefined);
  const [contentTypeFilter, setContentTypeFilter] = useState<string>('all');

  const { data: searchResult, isLoading: searchLoading } = useKnowledgeBaseSearch(
    projectPath,
    searchQuery,
    searchContentType
  );

  if (!projectPath) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p>Select a project to view its knowledge base.</p>
      </div>
    );
  }

  // Count files by content type
  const typeCounts: Record<string, number> = {};
  if (status?.files) {
    for (const file of status.files) {
      typeCounts[file.contentType] = (typeCounts[file.contentType] || 0) + 1;
    }
  }

  // Filter files by content type
  const filteredFiles =
    contentTypeFilter === 'all'
      ? (status?.files ?? [])
      : (status?.files ?? []).filter((f) => f.contentType === contentTypeFilter);

  // Parse search results into snippets
  const searchSnippets = searchResult?.context
    ? searchResult.context.split('\n\n').filter((s) => s.trim().length > 0)
    : [];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Database className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Knowledge Base</h1>
          {status?.projectId && (
            <span className="text-xs text-muted-foreground">({status.projectId})</span>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => indexMutation.mutate()}
            disabled={indexMutation.isPending || !status?.configured}
          >
            {indexMutation.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            )}
            Re-index
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => indexCodeMutation.mutate()}
            disabled={indexCodeMutation.isPending || !status?.configured}
          >
            {indexCodeMutation.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Bot className="mr-1.5 h-3.5 w-3.5" />
            )}
            Index Code
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Status Section */}
        <section>
          <h2 className="text-sm font-medium mb-3">Status</h2>
          {statusLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading status...
            </div>
          ) : status ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-lg border p-3">
                <StatusIndicator ok={status.enabled} label="RAG Enabled" />
              </div>
              <div className="rounded-lg border p-3">
                <StatusIndicator ok={status.configured} label="Configured" />
              </div>
              <div className="rounded-lg border p-3">
                <StatusIndicator ok={status.indexed} label="Indexed" />
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">Total Files</div>
                <div className="text-lg font-semibold">
                  {status.fileCount ?? status.files.length}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <AlertCircle className="h-3.5 w-3.5" />
              Could not load status
            </div>
          )}

          {/* Type breakdown */}
          {Object.keys(typeCounts).length > 0 && (
            <div className="flex gap-3 mt-3">
              {Object.entries(typeCounts).map(([type, count]) => (
                <div key={type} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <ContentTypeBadge type={type} />
                  <span>{count}</span>
                </div>
              ))}
            </div>
          )}

          {/* Index results */}
          {indexMutation.data && (
            <div className="mt-3 rounded-lg border border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-950/20 p-3 text-xs text-green-700 dark:text-green-400">
              Context: indexed {indexMutation.data.summary.indexed} files, skipped{' '}
              {indexMutation.data.summary.skipped},
              {indexMutation.data.summary.failed > 0 &&
                ` ${indexMutation.data.summary.failed} failed,`}{' '}
              in {(indexMutation.data.summary.duration / 1000).toFixed(1)}s
            </div>
          )}
          {indexCodeMutation.data && (
            <div className="mt-2 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20 p-3 text-xs text-blue-700 dark:text-blue-400">
              Code: indexed {indexCodeMutation.data.summary.indexed} files, skipped{' '}
              {indexCodeMutation.data.summary.skipped},
              {indexCodeMutation.data.summary.failed > 0 &&
                ` ${indexCodeMutation.data.summary.failed} failed,`}{' '}
              in {(indexCodeMutation.data.summary.duration / 1000).toFixed(1)}s
            </div>
          )}
        </section>

        {/* Content Browser */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium">Indexed Content</h2>
            <div className="flex gap-1">
              {['all', 'context', 'memory', 'agent-output', 'code'].map((type) => (
                <button
                  key={type}
                  onClick={() => setContentTypeFilter(type)}
                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium transition-colors ${
                    contentTypeFilter === type
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  }`}
                >
                  {type === 'all' ? 'All' : (CONTENT_TYPE_LABELS[type]?.label ?? type)}
                </button>
              ))}
            </div>
          </div>

          {filteredFiles.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
              {status?.indexed
                ? 'No files match this filter.'
                : 'No content indexed yet. Click "Re-index" to start.'}
            </div>
          ) : (
            <div className="rounded-lg border divide-y max-h-64 overflow-y-auto">
              {filteredFiles.map((file: KBFile) => (
                <div
                  key={file.filePath}
                  className="flex items-center justify-between px-3 py-2 text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <ContentTypeBadge type={file.contentType} />
                    <span className="truncate text-muted-foreground">{file.filePath}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground/60 shrink-0 ml-2">
                    {new Date(file.lastIndexed).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Search Interface */}
        <section>
          <h2 className="text-sm font-medium mb-3">Semantic Search</h2>
          <div className="flex gap-2 mb-3">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search the knowledge base..."
                className="pl-8 text-sm"
              />
            </div>
            <select
              value={searchContentType ?? ''}
              onChange={(e) => setSearchContentType(e.target.value || undefined)}
              className="rounded-md border bg-background px-2 text-xs text-muted-foreground"
            >
              <option value="">All types</option>
              <option value="context">Context</option>
              <option value="memory">Memory</option>
              <option value="agent-output">Agent Output</option>
              <option value="code">Code</option>
            </select>
          </div>

          {searchLoading && (
            <div className="flex items-center gap-2 text-muted-foreground text-xs py-4">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Searching...
            </div>
          )}

          {searchResult && searchSnippets.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] text-muted-foreground">
                {searchResult.chunksRetrieved} results in {searchResult.latencyMs}ms
              </p>
              {searchSnippets.map((snippet, i) => (
                <div
                  key={i}
                  className="rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
                >
                  <p className="line-clamp-4 whitespace-pre-wrap">{snippet}</p>
                  {searchResult.sources[i] && (
                    <p className="mt-1.5 text-[10px] opacity-50">{searchResult.sources[i]}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {searchResult && searchSnippets.length === 0 && searchQuery.length >= 3 && (
            <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
              No results found for "{searchQuery}"
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
