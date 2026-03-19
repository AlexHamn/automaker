import { useState } from 'react';
import { ChevronDown, ChevronRight, Shield, Loader2 } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useRiskAssessment } from '@/hooks/queries';

interface RiskIndicatorProps {
  projectPath: string | undefined;
  title: string | undefined;
  description: string;
  category?: string;
}

const RISK_COLORS = {
  low: {
    text: 'text-green-600 dark:text-green-400',
    bg: 'bg-green-100 dark:bg-green-900/40',
    border: 'border-green-200/50 dark:border-green-800/30',
    panelBg: 'bg-green-50/30 dark:bg-green-950/20',
  },
  medium: {
    text: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-100 dark:bg-amber-900/40',
    border: 'border-amber-200/50 dark:border-amber-800/30',
    panelBg: 'bg-amber-50/30 dark:bg-amber-950/20',
  },
  high: {
    text: 'text-red-600 dark:text-red-400',
    bg: 'bg-red-100 dark:bg-red-900/40',
    border: 'border-red-200/50 dark:border-red-800/30',
    panelBg: 'bg-red-50/30 dark:bg-red-950/20',
  },
};

export function RiskIndicator({ projectPath, title, description, category }: RiskIndicatorProps) {
  const [isOpen, setIsOpen] = useState(false);

  const { data, isLoading } = useRiskAssessment(projectPath, title, description, category);

  // Don't render if no assessment or loading with no prior data
  if (!isLoading && !data) return null;
  // Don't show for low risk with no factors
  if (data && data.riskLevel === 'low' && data.factors.length === 0) return null;

  const colors = data ? RISK_COLORS[data.riskLevel] : RISK_COLORS.low;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger
        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs ${colors.text} hover:bg-muted/50 transition-colors`}
      >
        {isLoading ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : isOpen ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        <Shield className="h-3 w-3" />
        <span>Risk Assessment</span>
        {data && (
          <span
            className={`ml-auto rounded-full ${colors.bg} px-1.5 py-0.5 text-[10px] font-medium capitalize`}
          >
            {data.riskLevel}
          </span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent>
        {data && (
          <div
            className={`mt-1 space-y-2 rounded-md border ${colors.border} ${colors.panelBg} p-2`}
          >
            {/* Risk score bar */}
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    data.riskLevel === 'low'
                      ? 'bg-green-500'
                      : data.riskLevel === 'medium'
                        ? 'bg-amber-500'
                        : 'bg-red-500'
                  }`}
                  style={{ width: `${Math.round(data.riskScore * 100)}%` }}
                />
              </div>
              <span className="text-[10px] text-muted-foreground">
                {Math.round(data.riskScore * 100)}%
              </span>
            </div>

            {/* Factors */}
            {data.factors.length > 0 && (
              <div className="space-y-1">
                {data.factors.map((factor, i) => (
                  <p key={i} className="text-[10px] text-muted-foreground">
                    {factor.description}
                  </p>
                ))}
              </div>
            )}

            {/* Recommendations */}
            {data.recommendations.length > 0 && (
              <div className="space-y-0.5">
                {data.recommendations.map((rec, i) => (
                  <p key={i} className="text-[10px] text-muted-foreground/80 italic">
                    {rec}
                  </p>
                ))}
              </div>
            )}

            <p className="text-[10px] text-muted-foreground/50">
              {data.similarFeatureCount} similar features analyzed in {data.latencyMs}ms
            </p>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
