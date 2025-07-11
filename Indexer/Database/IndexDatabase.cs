using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging;
using NtfsIndexer.Models;

namespace NtfsIndexer.Database;

public class IndexDatabase : IDisposable
{
    private readonly SqliteConnection _connection;
    private readonly ILogger<IndexDatabase> _logger;
    private bool _disposed;

    public IndexDatabase(string dbPath, ILogger<IndexDatabase> logger)
    {
        _logger = logger;
        
        var connectionStringBuilder = new SqliteConnectionStringBuilder
        {
            DataSource = dbPath,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Cache = SqliteCacheMode.Shared
        };

        _connection = new SqliteConnection(connectionStringBuilder.ConnectionString);
        _connection.Open();

        // Enable WAL mode for better performance
        using var walCommand = _connection.CreateCommand();
        walCommand.CommandText = "PRAGMA journal_mode=WAL;";
        walCommand.ExecuteNonQuery();

        InitializeDatabase();
    }

    private void InitializeDatabase()
    {
        using var command = _connection.CreateCommand();
        command.CommandText = @"
            CREATE TABLE IF NOT EXISTS files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                path TEXT NOT NULL UNIQUE,
                extension TEXT,
                size INTEGER NOT NULL,
                ctime TEXT NOT NULL,
                mtime TEXT NOT NULL,
                atime TEXT NOT NULL,
                mimeType TEXT NOT NULL,
                filehash TEXT,
                isDirectory INTEGER NOT NULL,
                parentpath TEXT,
                attributes INTEGER NOT NULL,
                indexedtime TEXT NOT NULL
            );
            
            CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);
            CREATE INDEX IF NOT EXISTS idx_files_name ON files(name);
            CREATE INDEX IF NOT EXISTS idx_files_extension ON files(extension);
            CREATE INDEX IF NOT EXISTS idx_files_mimeType ON files(mimeType);
            CREATE INDEX IF NOT EXISTS idx_files_parentpath ON files(parentpath);
            CREATE INDEX IF NOT EXISTS idx_files_isDirectory ON files(isDirectory);
            CREATE INDEX IF NOT EXISTS idx_files_mtime ON files(mtime);
            
            CREATE TABLE IF NOT EXISTS metadata (
                key TEXT PRIMARY KEY,
                value TEXT
            );
            
            INSERT OR IGNORE INTO metadata (key, value) 
            VALUES ('db_version', '1.0');
        ";
        command.ExecuteNonQuery();

        _logger.LogInformation("Database initialized successfully");
    }

    public void InsertFileEntry(FileEntry entry)
    {
        using var command = _connection.CreateCommand();
        command.CommandText = @"
            INSERT OR REPLACE INTO files 
            (name, path, extension, size, ctime, mtime, atime, 
             mimeType, filehash, isDirectory, parentpath, attributes, indexedtime)
            VALUES 
            (@name, @path, @extension, @size, @ctime, @mtime, @atime,
             @mimeType, @filehash, @isDirectory, @parentpath, @attributes, @indexedtime)";

        command.Parameters.AddWithValue("@name", entry.FileName);
        command.Parameters.AddWithValue("@path", entry.FullPath);
        command.Parameters.AddWithValue("@extension", entry.Extension);
        command.Parameters.AddWithValue("@size", entry.Size);
        command.Parameters.AddWithValue("@ctime", entry.CreationTime.ToString("O"));
        command.Parameters.AddWithValue("@mtime", entry.LastWriteTime.ToString("O"));
        command.Parameters.AddWithValue("@atime", entry.LastAccessTime.ToString("O"));
        command.Parameters.AddWithValue("@mimeType", entry.MimeType);
        command.Parameters.AddWithValue("@filehash", entry.FileHash ?? (object)DBNull.Value);
        command.Parameters.AddWithValue("@isDirectory", entry.IsDirectory ? 1 : 0);
        command.Parameters.AddWithValue("@parentpath", entry.ParentPath ?? (object)DBNull.Value);
        command.Parameters.AddWithValue("@attributes", (int)entry.Attributes);
        command.Parameters.AddWithValue("@indexedtime", entry.IndexedTime.ToString("O"));

        command.ExecuteNonQuery();
    }

    public void InsertFileEntries(IEnumerable<FileEntry> entries)
    {
        using var transaction = _connection.BeginTransaction();
        try
        {
            foreach (var entry in entries)
            {
                InsertFileEntry(entry);
            }
            transaction.Commit();
            _logger.LogDebug("Batch insert completed successfully");
        }
        catch (Exception ex)
        {
            transaction.Rollback();
            _logger.LogError(ex, "Error during batch insert");
            throw;
        }
    }

    public void DeleteEntry(string fullPath)
    {
        using var command = _connection.CreateCommand();
        command.CommandText = "DELETE FROM files WHERE path = @path";
        command.Parameters.AddWithValue("@path", fullPath);
        var rowsAffected = command.ExecuteNonQuery();
        
        if (rowsAffected > 0)
        {
            _logger.LogDebug("Deleted file: {Path}", fullPath);
        }
    }

    public void DeleteEntriesWithPrefix(string pathPrefix)
    {
        using var command = _connection.CreateCommand();
        
        string normalizedPrefix = pathPrefix;
        if (!normalizedPrefix.EndsWith("/") && !normalizedPrefix.EndsWith("\\"))
        {
            normalizedPrefix += "/";
        }
        
        command.CommandText = "DELETE FROM files WHERE path = @exactPath OR path LIKE @prefix";
        command.Parameters.AddWithValue("@exactPath", pathPrefix); // Delete the directory itself
        command.Parameters.AddWithValue("@prefix", $"{normalizedPrefix}%"); // Delete all contents
        
        var rowsAffected = command.ExecuteNonQuery();
        
        if (rowsAffected > 0)
        {
            _logger.LogDebug("Deleted {Count} files with prefix: {Prefix}", rowsAffected, pathPrefix);
        }
    }

    public void ClearIndex()
    {
        using var transaction = _connection.BeginTransaction();
        try
        {
            // Clear all files
            using var deleteFilesCommand = _connection.CreateCommand();
            deleteFilesCommand.CommandText = "DELETE FROM files";
            deleteFilesCommand.ExecuteNonQuery();

            // Clear the 'last_built' metadata to indicate the index is no longer built
            using var updateMetadataCommand = _connection.CreateCommand();
            updateMetadataCommand.CommandText = "DELETE FROM metadata WHERE key = 'last_built'";
            updateMetadataCommand.ExecuteNonQuery();

            transaction.Commit();
            _logger.LogInformation("Index cleared successfully");
        }
        catch (Exception ex)
        {
            transaction.Rollback();
            _logger.LogError(ex, "Error clearing index");
            throw;
        }
    }

    public FileEntry? GetEntry(string fullPath)
    {
        using var command = _connection.CreateCommand();
        command.CommandText = "SELECT * FROM files WHERE path = @path";
        command.Parameters.AddWithValue("@path", fullPath);

        using var reader = command.ExecuteReader();
        if (!reader.Read()) return null;

        return CreateFileEntryFromReader(reader);
    }

    public IEnumerable<FileEntry> SearchFiles(string searchTerm, int limit = 100)
    {
        using var command = _connection.CreateCommand();
        command.CommandText = @"
            SELECT * FROM files 
            WHERE (name LIKE @search OR path LIKE @search) 
            ORDER BY isDirectory DESC, name ASC 
            LIMIT @limit";
        
        command.Parameters.AddWithValue("@search", $"%{searchTerm}%");
        command.Parameters.AddWithValue("@limit", limit);

        using var reader = command.ExecuteReader();
        var results = new List<FileEntry>();
        
        while (reader.Read())
        {
            results.Add(CreateFileEntryFromReader(reader));
        }
        
        return results;
    }

    public long GetTotalFileCount()
    {
        using var command = _connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM files";
        return (long)command.ExecuteScalar()!;
    }

    public void UpdateMetadata(string key, string value)
    {
        using var command = _connection.CreateCommand();
        command.CommandText = @"
            INSERT OR REPLACE INTO metadata (key, value) 
            VALUES (@key, @value)";
        
        command.Parameters.AddWithValue("@key", key);
        command.Parameters.AddWithValue("@value", value);
        
        command.ExecuteNonQuery();
    }

    public string? GetMetadata(string key)
    {
        using var command = _connection.CreateCommand();
        command.CommandText = "SELECT value FROM metadata WHERE key = @key";
        command.Parameters.AddWithValue("@key", key);
        
        return command.ExecuteScalar() as string;
    }

    private FileEntry CreateFileEntryFromReader(SqliteDataReader reader)
    {
        return new FileEntry
        {
            Id = reader.GetInt64(reader.GetOrdinal("id")),
            FileName = reader.GetString(reader.GetOrdinal("name")),
            FullPath = reader.GetString(reader.GetOrdinal("path")),
            Extension = reader.IsDBNull(reader.GetOrdinal("extension")) ? string.Empty : reader.GetString(reader.GetOrdinal("extension")),
            Size = reader.GetInt64(reader.GetOrdinal("size")),
            CreationTime = DateTime.Parse(reader.GetString(reader.GetOrdinal("ctime"))),
            LastWriteTime = DateTime.Parse(reader.GetString(reader.GetOrdinal("mtime"))),
            LastAccessTime = DateTime.Parse(reader.GetString(reader.GetOrdinal("atime"))),
            MimeType = reader.GetString(reader.GetOrdinal("mimeType")),
            FileHash = reader.IsDBNull(reader.GetOrdinal("filehash")) ? null : reader.GetString(reader.GetOrdinal("filehash")),
            IsDirectory = reader.GetInt32(reader.GetOrdinal("isDirectory")) == 1,
            ParentPath = reader.IsDBNull(reader.GetOrdinal("parentpath")) ? null : reader.GetString(reader.GetOrdinal("parentpath")),
            Attributes = (FileAttributes)reader.GetInt32(reader.GetOrdinal("attributes")),
            IndexedTime = DateTime.Parse(reader.GetString(reader.GetOrdinal("indexedtime")))
        };
    }

    public void Dispose()
    {
        if (!_disposed)
        {
            _connection.Dispose();
            _disposed = true;
        }
        GC.SuppressFinalize(this);
    }
} 