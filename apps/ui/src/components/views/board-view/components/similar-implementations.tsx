import { useState } from 'react';
import { ChevronDown, ChevronRight, Search, Loader2 } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useSimilarImplementations } from '@/hooks/queries';

interface SimilarImplementationsProps {
  projectPath: string | undefined;
  description: string;
  category?: string;
}

export function SimilarImplementations({
  projectPath,
  description,
  category,
}: SimilarImplementationsProps) {
  const [isOpen, setIsOpen] = useState(false);

  const { data, isLoading } = useSimilarImplementations(projectPath, description, category);

  // Don't render anything if no results and not loading
  if (!isLoading && (!data || data.chunksRetrieved === 0)) {
    return null;
  }

  const sources = data?.sources ?? [];
  const contextSnippets = data?.context
    ? data.context
        .split('\n\n')
        .filter((s) => s.trim().length > 0)
        .slice(0, 5)
    : [];

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted/50 transition-colors">
        {isLoading ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : isOpen ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        <Search className="h-3 w-3" />
        <span>Similar Past Work</span>
        {data && data.chunksRetrieved > 0 && (
          <span className="ml-auto rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium">
            {data.chunksRetrieved}
          </span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 space-y-1.5 rounded-md border border-border/50 bg-muted/30 p-2">
          {contextSnippets.map((snippet, i) => (
            <div
              key={i}
              className="rounded border border-border/30 bg-background/50 px-2 py-1.5 text-xs text-muted-foreground"
            >
              <p className="line-clamp-3">{snippet}</p>
              {sources[i] && <p className="mt-1 text-[10px] opacity-60">{sources[i]}</p>}
            </div>
          ))}
          {data && (
            <p className="text-[10px] text-muted-foreground/50 px-1">
              {data.chunksRetrieved} matches in {data.latencyMs}ms
            </p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
