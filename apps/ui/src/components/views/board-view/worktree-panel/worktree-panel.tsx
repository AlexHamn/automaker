import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { GitBranch, Plus, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import { cn, pathsEqual } from "@/lib/utils";
import type { WorktreePanelProps, WorktreeInfo } from "./types";
import {
  useWorktrees,
  useDevServers,
  useBranches,
  useWorktreeActions,
  useDefaultEditor,
  useRunningFeatures,
} from "./hooks";
import { WorktreeTab } from "./components";

const WORKTREE_PANEL_COLLAPSED_KEY = "worktree-panel-collapsed";

export function WorktreePanel({
  projectPath,
  onCreateWorktree,
  onDeleteWorktree,
  onCommit,
  onCreatePR,
  onCreateBranch,
  onAddressPRComments,
  onResolveConflicts,
  onRemovedWorktrees,
  runningFeatureIds = [],
  features = [],
  branchCardCounts,
  refreshTrigger = 0,
}: WorktreePanelProps) {
  const {
    isLoading,
    worktrees,
    currentWorktree,
    currentWorktreePath,
    useWorktreesEnabled,
    fetchWorktrees,
    handleSelectWorktree,
  } = useWorktrees({ projectPath, refreshTrigger, onRemovedWorktrees });

  const {
    isStartingDevServer,
    getWorktreeKey,
    isDevServerRunning,
    getDevServerInfo,
    handleStartDevServer,
    handleStopDevServer,
    handleOpenDevServerUrl,
  } = useDevServers({ projectPath });

  const {
    branches,
    filteredBranches,
    aheadCount,
    behindCount,
    isLoadingBranches,
    branchFilter,
    setBranchFilter,
    resetBranchFilter,
    fetchBranches,
  } = useBranches();

  const {
    isPulling,
    isPushing,
    isSwitching,
    isActivating,
    handleSwitchBranch,
    handlePull,
    handlePush,
    handleOpenInEditor,
  } = useWorktreeActions({
    fetchWorktrees,
    fetchBranches,
  });

  const { defaultEditorName } = useDefaultEditor();

  const { hasRunningFeatures } = useRunningFeatures({
    runningFeatureIds,
    features,
  });

  // Collapse state with localStorage persistence
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    const saved = localStorage.getItem(WORKTREE_PANEL_COLLAPSED_KEY);
    return saved === "true";
  });

  useEffect(() => {
    localStorage.setItem(WORKTREE_PANEL_COLLAPSED_KEY, String(isCollapsed));
  }, [isCollapsed]);

  const toggleCollapsed = () => setIsCollapsed((prev) => !prev);

  // Get the currently selected worktree for collapsed view
  const selectedWorktree = worktrees.find((w) => {
    if (currentWorktree === null || currentWorktree === undefined || currentWorktree.path === null) {
      return w.isMain;
    }
    return pathsEqual(w.path, currentWorktreePath);
  });

  const isWorktreeSelected = (worktree: WorktreeInfo) => {
    return worktree.isMain
      ? currentWorktree === null ||
          currentWorktree === undefined ||
          currentWorktree.path === null
      : pathsEqual(worktree.path, currentWorktreePath);
  };

  const handleBranchDropdownOpenChange = (worktree: WorktreeInfo) => (open: boolean) => {
    if (open) {
      fetchBranches(worktree.path);
      resetBranchFilter();
    }
  };

  const handleActionsDropdownOpenChange = (worktree: WorktreeInfo) => (open: boolean) => {
    if (open) {
      fetchBranches(worktree.path);
    }
  };

  if (!useWorktreesEnabled) {
    return null;
  }

  // Collapsed view - just show current branch and toggle
  if (isCollapsed) {
    return (
      <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border bg-glass/50 backdrop-blur-sm">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
          onClick={toggleCollapsed}
          title="Expand worktree panel"
        >
          <ChevronDown className="w-4 h-4" />
        </Button>
        <GitBranch className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Branch:</span>
        <span className="text-sm font-mono font-medium">
          {selectedWorktree?.branch ?? "main"}
        </span>
        {selectedWorktree?.hasChanges && (
          <span className="inline-flex items-center justify-center h-4 min-w-[1rem] px-1 text-[10px] font-medium rounded border bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/30">
            {selectedWorktree.changedFilesCount ?? "!"}
          </span>
        )}
      </div>
    );
  }

  // Expanded view - full worktree panel
  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-glass/50 backdrop-blur-sm">
      <Button
        variant="ghost"
        size="sm"
        className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
        onClick={toggleCollapsed}
        title="Collapse worktree panel"
      >
        <ChevronUp className="w-4 h-4" />
      </Button>
      <GitBranch className="w-4 h-4 text-muted-foreground" />
      <span className="text-sm text-muted-foreground mr-2">Branch:</span>

      <div className="flex items-center gap-2 flex-wrap">
        {worktrees.map((worktree) => {
          const cardCount = branchCardCounts?.[worktree.branch];
          return (
            <WorktreeTab
              key={worktree.path}
              worktree={worktree}
              cardCount={cardCount}
              hasChanges={worktree.hasChanges}
              changedFilesCount={worktree.changedFilesCount}
              isSelected={isWorktreeSelected(worktree)}
              isRunning={hasRunningFeatures(worktree)}
              isActivating={isActivating}
              isDevServerRunning={isDevServerRunning(worktree)}
              devServerInfo={getDevServerInfo(worktree)}
              defaultEditorName={defaultEditorName}
              branches={branches}
              filteredBranches={filteredBranches}
              branchFilter={branchFilter}
              isLoadingBranches={isLoadingBranches}
              isSwitching={isSwitching}
              isPulling={isPulling}
              isPushing={isPushing}
              isStartingDevServer={isStartingDevServer}
              aheadCount={aheadCount}
              behindCount={behindCount}
              onSelectWorktree={handleSelectWorktree}
              onBranchDropdownOpenChange={handleBranchDropdownOpenChange(worktree)}
              onActionsDropdownOpenChange={handleActionsDropdownOpenChange(worktree)}
              onBranchFilterChange={setBranchFilter}
              onSwitchBranch={handleSwitchBranch}
              onCreateBranch={onCreateBranch}
              onPull={handlePull}
              onPush={handlePush}
              onOpenInEditor={handleOpenInEditor}
              onCommit={onCommit}
              onCreatePR={onCreatePR}
              onAddressPRComments={onAddressPRComments}
              onResolveConflicts={onResolveConflicts}
              onDeleteWorktree={onDeleteWorktree}
              onStartDevServer={handleStartDevServer}
              onStopDevServer={handleStopDevServer}
              onOpenDevServerUrl={handleOpenDevServerUrl}
            />
          );
        })}

        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
          onClick={onCreateWorktree}
          title="Create new worktree"
        >
          <Plus className="w-4 h-4" />
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
          onClick={async () => {
            const removedWorktrees = await fetchWorktrees();
            if (removedWorktrees && removedWorktrees.length > 0 && onRemovedWorktrees) {
              onRemovedWorktrees(removedWorktrees);
            }
          }}
          disabled={isLoading}
          title="Refresh worktrees"
        >
          <RefreshCw
            className={cn("w-3.5 h-3.5", isLoading && "animate-spin")}
          />
        </Button>
      </div>
    </div>
  );
}
