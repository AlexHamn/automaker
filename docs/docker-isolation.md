# Docker Isolation

This document describes Automaker's Docker isolation model and how data is persisted across container rebuilds.

## Overview

When running Automaker in Docker using the standard `docker-compose.yml`, the container is completely isolated from your host filesystem. All data is stored in Docker-managed named volumes that persist across container rebuilds.

## Named Volumes

The production Docker configuration uses the following named volumes:

| Volume | Container Path | Purpose |
|--------|---------------|---------|
| `automaker-projects` | `/projects` | All project data (kanban boards, features, specs, context, ideas) |
| `automaker-data` | `/data` | Global settings, credentials, session metadata, agent histories |
| `automaker-claude-config` | `/home/automaker/.claude` | Claude CLI OAuth session keys and configuration |
| `automaker-cursor-config` | `/home/automaker/.cursor` | Cursor CLI configuration and authentication |
| `automaker-opencode-data` | `/home/automaker/.local/share/opencode` | OpenCode CLI data and authentication |
| `automaker-opencode-config` | `/home/automaker/.config/opencode` | OpenCode user configuration |
| `automaker-opencode-cache` | `/home/automaker/.cache/opencode` | OpenCode cache directory |

## Projects Volume

The `automaker-projects` volume stores all project data created inside the container:

```
/projects/
└── your-project/
    ├── .automaker/
    │   ├── features/        # Feature JSON files and images
    │   ├── context/         # Context files for AI agents
    │   ├── ideation/        # Brainstorming and analysis data
    │   ├── settings.json    # Project-specific settings
    │   └── app_spec.txt     # Project specification
    └── src/                 # Your project source code
```

This volume persists across:
- Container restarts (`docker-compose restart`)
- Container rebuilds (`docker-compose up --build`)
- Image updates (`docker-compose pull && docker-compose up -d`)

The volume is only deleted when you explicitly remove it with `docker volume rm automaker-projects`.

## Working with Host Directories

If you need to work on projects from your host filesystem (e.g., existing codebases), create a `docker-compose.override.yml` file:

```yaml
services:
  server:
    volumes:
      # Mount your project directories
      - /path/to/your/project:/projects/your-project
```

This file is gitignored and won't affect the default isolation.

## Development Mode

The development Docker configurations (`docker-compose.dev.yml`, `docker-compose.dev-server.yml`) use host mounts instead of named volumes:

- `./data:/data` - Host mount for shared data with Electron
- `./projects:/projects` - Host mount for project data

This allows developers to access project files directly from the host filesystem.

## Volume Management

### List volumes

```bash
docker volume ls | grep automaker
```

### Inspect a volume

```bash
docker volume inspect automaker-projects
```

### Backup a volume

```bash
# Create a backup of the projects volume
docker run --rm -v automaker-projects:/data -v $(pwd):/backup alpine tar czf /backup/projects-backup.tar.gz -C /data .
```

### Restore a volume

```bash
# Restore from backup
docker run --rm -v automaker-projects:/data -v $(pwd):/backup alpine sh -c "cd /data && tar xzf /backup/projects-backup.tar.gz"
```

### Delete volumes (Warning: destroys data)

```bash
# Stop containers first
docker-compose down

# Remove specific volume
docker volume rm automaker-projects

# Remove all automaker volumes
docker volume rm $(docker volume ls -q | grep automaker)
```

## Security Model

The isolation model provides:

1. **No host filesystem access** - Container cannot read or modify files on your laptop
2. **Isolated network** - Only exposed ports (3007, 3008) are accessible
3. **Non-root execution** - Server runs as unprivileged `automaker` user
4. **No privileged mode** - Container has no elevated capabilities

This means if an AI agent behaves unexpectedly, it can only affect data within the container's named volumes, not your host system.

## See Also

- [README.md - Docker Deployment](../README.md#docker-deployment) - Quick start guide
- [DISCLAIMER.md](../DISCLAIMER.md) - Security warnings and recommendations
