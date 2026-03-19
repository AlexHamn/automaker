import { useState } from 'react';
import { ChevronDown, ChevronRight, AlertTriangle, Loader2 } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useGotchaWarnings } from '@/hooks/queries';

interface GotchaWarningsProps {
  projectPath: string | undefined;
  description: string;
}

export function GotchaWarnings({ projectPath, description }: GotchaWarningsProps) {
  const [isOpen, setIsOpen] = useState(false);

  const { data, isLoading } = useGotchaWarnings(projectPath, description);

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
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-colors">
        {isLoading ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : isOpen ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        <AlertTriangle className="h-3 w-3" />
        <span>Potential Issues</span>
        {data && data.chunksRetrieved > 0 && (
          <span className="ml-auto rounded-full bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 text-[10px] font-medium">
            {data.chunksRetrieved}
          </span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 space-y-1.5 rounded-md border border-amber-200/50 dark:border-amber-800/30 bg-amber-50/30 dark:bg-amber-950/20 p-2">
          {contextSnippets.map((snippet, i) => (
            <div
              key={i}
              className="rounded border border-amber-200/30 dark:border-amber-800/20 bg-background/50 px-2 py-1.5 text-xs text-muted-foreground"
            >
              <p className="line-clamp-3">{snippet}</p>
              {sources[i] && <p className="mt-1 text-[10px] opacity-60">{sources[i]}</p>}
            </div>
          ))}
          {data && (
            <p className="text-[10px] text-amber-600/50 dark:text-amber-400/50 px-1">
              {data.chunksRetrieved} warnings in {data.latencyMs}ms
            </p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
