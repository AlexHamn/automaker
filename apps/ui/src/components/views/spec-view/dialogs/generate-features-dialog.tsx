import { ListPlus, Clock } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { HotkeyButton } from '@/components/ui/hotkey-button';
import { cn } from '@/lib/utils';
import { FEATURE_COUNT_OPTIONS } from '../constants';
import type { GenerateFeaturesDialogProps, FeatureCount } from '../types';

export function GenerateFeaturesDialog({
  open,
  onOpenChange,
  featureCount,
  onFeatureCountChange,
  onGenerate,
  isGenerating,
}: GenerateFeaturesDialogProps) {
  const selectedOption = FEATURE_COUNT_OPTIONS.find((o) => o.value === featureCount);

  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        if (!open && !isGenerating) {
          onOpenChange(false);
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Generate Features</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Create features from the implementation roadmap in your app specification.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-4">
          <label className="text-sm font-medium">Number of Features</label>
          <div className="flex gap-2">
            {FEATURE_COUNT_OPTIONS.map((option) => (
              <Button
                key={option.value}
                type="button"
                variant={featureCount === option.value ? 'default' : 'outline'}
                size="sm"
                onClick={() => onFeatureCountChange(option.value as FeatureCount)}
                disabled={isGenerating}
                className={cn(
                  'flex-1 transition-all',
                  featureCount === option.value
                    ? 'bg-primary hover:bg-primary/90 text-primary-foreground'
                    : 'bg-muted/30 hover:bg-muted/50 border-border'
                )}
                data-testid={`generate-feature-count-${option.value}`}
              >
                {option.label}
              </Button>
            ))}
          </div>
          {selectedOption?.warning && (
            <p className="text-xs text-amber-500 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {selectedOption.warning}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isGenerating}>
            Cancel
          </Button>
          <HotkeyButton
            onClick={onGenerate}
            disabled={isGenerating}
            hotkey={{ key: 'Enter', cmdCtrl: true }}
            hotkeyActive={open && !isGenerating}
          >
            {isGenerating ? (
              <>
                <Spinner size="sm" className="mr-2" />
                Generating...
              </>
            ) : (
              <>
                <ListPlus className="w-4 h-4 mr-2" />
                Generate Features
              </>
            )}
          </HotkeyButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
