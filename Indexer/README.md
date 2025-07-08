# NTFS File System Indexer

A high-performance file system indexer for Windows NTFS volumes with real-time monitoring capabilities.

## Features

- **Fast Initial Indexing**: Efficiently scans and indexes entire directory trees
- **Real-time Monitoring**: Automatically updates the index when files are created, modified, or deleted
- **Comprehensive Metadata**: Stores file names, paths, sizes, timestamps, MIME types, and attributes
- **Advanced Search**: Fast searching by filename, path, or MIME type
- **SQLite Database**: Lightweight, embedded database with WAL mode for performance
- **Command-line Interface**: Easy-to-use CLI with multiple commands
- **Logging**: Comprehensive logging with configurable levels
- **Cross-platform**: Built on .NET 8.0

## Prerequisites

- .NET 8.0 SDK
- Windows 10/11 (recommended to run as Administrator for full access)
- PowerShell 5.1 or higher

## Quick Start

### 1. Build the Project

```powershell
.\build.ps1
```

### 2. Build Initial Index

```powershell
.\build.ps1 -Command run-build -Path "D:\MyFiles"
```

### 3. Start Real-time Monitoring

```powershell
.\build.ps1 -Command run-monitor -Path "D:\MyFiles"
```

### 4. Full Indexing (Build + Monitor)

```powershell
.\build.ps1 -Command run-full -Path "D:\MyFiles"
```

## Commands

### Build Index
Creates an initial index of all files in the specified directory:
```powershell
.\build.ps1 -Command run-build -Path "C:\Users"
```

### Monitor Changes
Monitors file system changes and updates the index in real-time:
```powershell
.\build.ps1 -Command run-monitor -Path "C:\Users"
```

### Full Indexing
Builds the initial index and then starts monitoring:
```powershell
.\build.ps1 -Command run-full -Path "C:\Users"
```

### Search Files
Search indexed files by name or path:
```powershell
.\build.ps1 -Command run-search -SearchTerm "photo" -Limit 100
```

### Show Status
Display indexer status and statistics:
```powershell
.\build.ps1 -Command run-status
```

## Direct CLI Usage

You can also use the compiled executable directly:

```powershell
# Build index
dotnet run -- build "D:\MyFiles"

# Monitor changes
dotnet run -- monitor "D:\MyFiles"

# Full indexing
dotnet run -- full "D:\MyFiles"

# Search files
dotnet run -- search "photo" --limit 50

# Show status
dotnet run -- status
```

## Database Schema

The indexer uses SQLite with the following main table structure:

```sql
CREATE TABLE files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    extension TEXT,
    size INTEGER NOT NULL,
    creation_time TEXT NOT NULL,
    last_write_time TEXT NOT NULL,
    last_access_time TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_hash TEXT,
    is_directory INTEGER NOT NULL,
    parent_path TEXT,
    attributes INTEGER NOT NULL,
    indexed_time TEXT NOT NULL,
    is_deleted INTEGER DEFAULT 0
);
```

## Performance Considerations

- **Initial Indexing**: Performance depends on the number of files and disk I/O speed
- **Memory Usage**: Processes files in batches of 1000 to manage memory efficiently
- **Database Size**: Approximately 200-500 bytes per file entry
- **Monitoring**: Uses a single FileSystemWatcher to avoid handle exhaustion

## Supported File Types

The indexer recognizes over 100 file types including:

- **Documents**: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX
- **Images**: JPG, PNG, GIF, BMP, TIFF, PSD, RAW, CR2, NEF
- **Videos**: MP4, AVI, MOV, WMV, MKV, WEBM
- **Audio**: MP3, WAV, FLAC, AAC, OGG
- **Archives**: ZIP, RAR, 7Z, TAR, GZ
- **Development**: C, CPP, CS, JAVA, PY, JS, TS, HTML, CSS
- **And many more...

## Logging

The application uses structured logging with the following levels:

- **Information**: General operation status
- **Warning**: Non-critical issues (e.g., access denied)
- **Error**: Critical errors that prevent operation
- **Debug**: Detailed operation information

## Error Handling

- **Access Denied**: Gracefully handles permission issues
- **File System Errors**: Continues operation despite individual file errors
- **Database Errors**: Automatic transaction rollback on failures
- **Cancellation**: Supports Ctrl+C for graceful shutdown

## Database Location

The SQLite database is stored at:
```
<Application Directory>\ntfs_index.db
```

## Limitations

- Requires Windows NTFS file system
- Some system files may be inaccessible without Administrator privileges
- Large directories (>1M files) may take significant time for initial indexing
- Real-time monitoring has a small delay due to debouncing

## Contributing

This is a demonstration project showcasing NTFS file system indexing capabilities. Feel free to extend it with additional features like:

- MFT (Master File Table) direct access for faster scanning
- USN Journal integration for change tracking
- Network drive support
- Content-based indexing
- Web interface
- API endpoints

## License

This project is provided as-is for educational and demonstration purposes. 