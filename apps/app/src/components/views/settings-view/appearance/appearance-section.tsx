import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Palette } from "lucide-react";
import { themeOptions } from "@/config/theme-options";
import { cn } from "@/lib/utils";
import type { Theme, Project } from "../shared/types";

interface AppearanceSectionProps {
  effectiveTheme: Theme;
  currentProject: Project | null;
  onThemeChange: (theme: Theme) => void;
}

export function AppearanceSection({
  effectiveTheme,
  currentProject,
  onThemeChange,
}: AppearanceSectionProps) {
  return (
    <div
      className={cn(
        "rounded-2xl overflow-hidden",
        "border border-border/50",
        "bg-gradient-to-br from-card/90 via-card/70 to-card/80 backdrop-blur-xl",
        "shadow-sm shadow-black/5"
      )}
    >
      <div className="p-6 border-b border-border/50 bg-gradient-to-r from-transparent via-accent/5 to-transparent">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500/20 to-brand-600/10 flex items-center justify-center border border-brand-500/20">
            <Palette className="w-5 h-5 text-brand-500" />
          </div>
          <h2 className="text-lg font-semibold text-foreground tracking-tight">Appearance</h2>
        </div>
        <p className="text-sm text-muted-foreground/80 ml-12">
          Customize the look and feel of your application.
        </p>
      </div>
      <div className="p-6 space-y-4">
        <div className="space-y-4">
          <Label className="text-foreground font-medium">
            Theme{" "}
            <span className="text-muted-foreground font-normal">
              {currentProject ? `(for ${currentProject.name})` : "(Global)"}
            </span>
          </Label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {themeOptions.map(({ value, label, Icon, testId }) => {
              const isActive = effectiveTheme === value;
              return (
                <button
                  key={value}
                  onClick={() => onThemeChange(value)}
                  className={cn(
                    "group flex items-center justify-center gap-2.5 px-4 py-3.5 rounded-xl",
                    "text-sm font-medium transition-all duration-200 ease-out",
                    isActive
                      ? [
                          "bg-gradient-to-br from-brand-500/15 to-brand-600/10",
                          "border-2 border-brand-500/40",
                          "text-foreground",
                          "shadow-md shadow-brand-500/10",
                        ]
                      : [
                          "bg-accent/30 hover:bg-accent/50",
                          "border border-border/50 hover:border-border",
                          "text-muted-foreground hover:text-foreground",
                          "hover:shadow-sm",
                        ],
                    "hover:scale-[1.02] active:scale-[0.98]"
                  )}
                  data-testid={testId}
                >
                  <Icon className={cn(
                    "w-4 h-4 transition-all duration-200",
                    isActive ? "text-brand-500" : "group-hover:text-brand-400"
                  )} />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
