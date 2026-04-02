import { useState, useEffect } from 'react';
import { createLogger } from '@automaker/utils/logger';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FolderOpen, Github, Folder } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { useFileBrowser } from '@/contexts/file-browser-context';
import { getDefaultWorkspaceDirectory, saveLastProjectDirectory } from '@/lib/workspace-config';

const logger = createLogger('NewProjectModal');

interface ValidationErrors {
  projectName?: boolean;
  workspaceDir?: boolean;
  customUrl?: boolean;
}

interface NewProjectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateBlankProject: (projectName: string, parentDir: string) => Promise<void>;
  onCreateFromCustomUrl: (repoUrl: string, projectName: string, parentDir: string) => Promise<void>;
  isCreating: boolean;
}

export function NewProjectModal({
  open,
  onOpenChange,
  onCreateBlankProject,
  onCreateFromCustomUrl,
  isCreating,
}: NewProjectModalProps) {
  const [projectName, setProjectName] = useState('');
  const [workspaceDir, setWorkspaceDir] = useState<string>('');
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(false);
  const [githubUrl, setGithubUrl] = useState('');
  const [errors, setErrors] = useState<ValidationErrors>({});
  const { openFileBrowser } = useFileBrowser();

  const isCloning = !!githubUrl.trim();

  // Fetch workspace directory when modal opens
  useEffect(() => {
    if (open) {
      setIsLoadingWorkspace(true);
      getDefaultWorkspaceDirectory()
        .then((defaultDir) => {
          if (defaultDir) {
            setWorkspaceDir(defaultDir);
          }
        })
        .catch((error) => {
          logger.error('Failed to get default workspace directory:', error);
        })
        .finally(() => {
          setIsLoadingWorkspace(false);
        });
    }
  }, [open]);

  // Reset form when modal closes
  useEffect(() => {
    if (!open) {
      setProjectName('');
      setGithubUrl('');
      setErrors({});
    }
  }, [open]);

  // Clear specific errors when user fixes them
  useEffect(() => {
    if (projectName && errors.projectName) {
      setErrors((prev) => ({ ...prev, projectName: false }));
    }
  }, [projectName, errors.projectName]);

  useEffect(() => {
    if (githubUrl && errors.customUrl) {
      setErrors((prev) => ({ ...prev, customUrl: false }));
    }
  }, [githubUrl, errors.customUrl]);

  const validateAndCreate = async () => {
    const newErrors: ValidationErrors = {};

    if (!projectName.trim()) {
      newErrors.projectName = true;
    }

    if (!workspaceDir) {
      newErrors.workspaceDir = true;
    }

    if (Object.values(newErrors).some(Boolean)) {
      setErrors(newErrors);
      return;
    }

    setErrors({});

    if (isCloning) {
      await onCreateFromCustomUrl(githubUrl, projectName, workspaceDir);
    } else {
      await onCreateBlankProject(projectName, workspaceDir);
    }
  };

  const handleBrowseDirectory = async () => {
    const selectedPath = await openFileBrowser({
      title: 'Select Base Project Directory',
      description: 'Choose the parent directory where your project will be created',
      initialPath: workspaceDir || undefined,
    });
    if (selectedPath) {
      setWorkspaceDir(selectedPath);
      saveLastProjectDirectory(selectedPath);
      if (errors.workspaceDir) {
        setErrors((prev) => ({ ...prev, workspaceDir: false }));
      }
    }
  };

  // Use platform-specific path separator
  const pathSep =
    typeof window !== 'undefined' && window.electronAPI
      ? navigator.platform.indexOf('Win') !== -1
        ? '\\'
        : '/'
      : '/';
  const projectPath = workspaceDir && projectName ? `${workspaceDir}${pathSep}${projectName}` : '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border max-w-lg" data-testid="new-project-modal">
        <DialogHeader className="pb-2">
          <DialogTitle className="text-foreground">Create New Project</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Start a new blank project, or clone from a GitHub repository.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Project Name */}
          <div className="space-y-2">
            <Label
              htmlFor="project-name"
              className={cn('text-foreground', errors.projectName && 'text-red-500')}
            >
              Project Name {errors.projectName && <span className="text-red-500">*</span>}
            </Label>
            <Input
              id="project-name"
              placeholder="my-awesome-project"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              className={cn(
                'bg-input text-foreground placeholder:text-muted-foreground',
                errors.projectName
                  ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20'
                  : 'border-border'
              )}
              data-testid="project-name-input"
              autoFocus
            />
            {errors.projectName && <p className="text-xs text-red-500">Project name is required</p>}
          </div>

          {/* Workspace Directory */}
          <div
            className={cn(
              'flex items-start gap-2 text-sm',
              errors.workspaceDir ? 'text-red-500' : 'text-muted-foreground'
            )}
          >
            <Folder className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="flex-1 min-w-0 flex flex-col gap-1">
              {isLoadingWorkspace ? (
                'Loading workspace...'
              ) : workspaceDir ? (
                <>
                  <span>Will be created at:</span>
                  <code
                    className="text-xs bg-muted px-1.5 py-0.5 rounded truncate block max-w-full"
                    title={projectPath || workspaceDir}
                  >
                    {projectPath || workspaceDir}
                  </code>
                </>
              ) : null}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleBrowseDirectory}
              disabled={isLoadingWorkspace}
              className="shrink-0 h-7 px-2 text-xs"
              data-testid="browse-directory-button"
            >
              <FolderOpen className="w-3.5 h-3.5 mr-1" />
              Browse
            </Button>
          </div>

          {/* GitHub URL (optional) */}
          <div className="space-y-2">
            <Label htmlFor="github-url" className="text-foreground flex items-center gap-1.5">
              <Github className="w-3.5 h-3.5" />
              GitHub URL
              <span className="text-muted-foreground text-xs font-normal">(optional)</span>
            </Label>
            <Input
              id="github-url"
              placeholder="https://github.com/username/repository"
              value={githubUrl}
              onChange={(e) => setGithubUrl(e.target.value)}
              className={cn(
                'bg-input text-foreground placeholder:text-muted-foreground',
                errors.customUrl
                  ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20'
                  : 'border-border'
              )}
              data-testid="custom-url-input"
            />
            <p className="text-xs text-muted-foreground">
              {isCloning
                ? 'The repository will be cloned into your new project.'
                : 'Leave empty to create a blank project.'}
            </p>
          </div>
        </div>

        <DialogFooter className="border-t border-border pt-4">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="text-muted-foreground hover:text-foreground hover:bg-accent"
          >
            Cancel
          </Button>
          <HotkeyButton
            onClick={validateAndCreate}
            disabled={isCreating}
            className="bg-gradient-to-r from-brand-500 to-brand-600 hover:from-brand-600 hover:to-brand-600 text-white border-0"
            hotkey={{ key: 'Enter', cmdCtrl: true }}
            hotkeyActive={open}
            data-testid="confirm-create-project"
          >
            {isCreating ? (
              <>
                <Spinner size="sm" className="mr-2" />
                {isCloning ? 'Cloning...' : 'Creating...'}
              </>
            ) : (
              <>Create Project</>
            )}
          </HotkeyButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
