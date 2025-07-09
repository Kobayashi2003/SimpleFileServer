# NTFS Indexer

A high-performance file system indexer for Windows NTFS drives with real-time monitoring capabilities.

## Features

- **Fast Indexing**: Efficiently indexes large directories with progress tracking
- **Real-time Monitoring**: Watches for file system changes and updates index automatically
- **SQLite Database**: Lightweight, portable database for storing file metadata
- **Search Capabilities**: Fast text-based search through indexed files
- **MIME Type Detection**: Automatic detection of file types
- **Relative Path Support**: Option to store relative paths for portability

## Commands

### Build Index
```bash
# Build index with confirmation prompt if database exists
dotnet run -- build "C:\Path\To\Index"

# Force rebuild without confirmation
dotnet run -- build "C:\Path\To\Index" --force
```

### Monitor Changes
```bash
# Monitor file system changes (requires existing index)
dotnet run -- monitor "C:\Path\To\Monitor"
```

### Full Indexing (Build + Monitor)
```bash
# Build index and start monitoring with confirmation
dotnet run -- full "C:\Path\To\Index"

# Force rebuild and start monitoring without confirmation
dotnet run -- full "C:\Path\To\Index" --force
```

### Search Files
```bash
# Search for files containing "example"
dotnet run -- search "example" --limit 50
```

### Show Status
```bash
# Display indexer status and statistics
dotnet run -- status
```

## Quick Start Script

Use the PowerShell script for easier execution:

```powershell
# Default mode (full indexing with confirmation)
.\run.ps1 -Path "H:\ACGN"

# Only build index with confirmation
.\run.ps1 -Path "H:\ACGN" -Mode index

# Only monitor changes
.\run.ps1 -Path "H:\ACGN" -Mode monitor

# Force rebuild without confirmation
.\run.ps1 -Path "H:\ACGN" -Mode full -Force
```

## Database Confirmation

When building an index, if a database already exists, the system will:

1. **Show database information** (path, size, last modified)
2. **Warn about data loss** - rebuilding deletes existing data
3. **Ask for confirmation** - requires explicit 'y' or 'yes' response
4. **Allow bypass with --force** flag for automated scenarios

### Example Confirmation Dialog
```
╔══════════════════════════════════════════════════════════════════════╗
║                          DATABASE EXISTS                            ║
╠══════════════════════════════════════════════════════════════════════╣
║ Path: D:\Program\Code\SimpleFileServer\Indexer\index.db             ║
║ Size: 15.32 MB                                                       ║
║ Modified: 2024-01-15 14:30:22                                        ║
╠══════════════════════════════════════════════════════════════════════╣
║ Building a new index will DELETE the existing database and all its  ║
║ indexed data. This operation cannot be undone.                      ║
╚══════════════════════════════════════════════════════════════════════╝

Do you want to proceed and rebuild the index? (y/N):
```

## Configuration

- **Database Location**: `index.db` in the application directory
- **Debounce Interval**: 500ms for file system events
- **Batch Size**: 1000 files per database transaction
- **Internal Buffer**: 64KB for FileSystemWatcher

## Performance Tips

- Use `--force` flag in automated scripts to avoid prompts
- Monitor specific subdirectories for better performance
- The database uses WAL mode for improved concurrent access
- File system watcher buffer increased to handle high-activity directories 