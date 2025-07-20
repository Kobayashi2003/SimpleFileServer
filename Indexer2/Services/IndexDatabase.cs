using System.Data.SQLite;
using System.Data;
using Microsoft.Extensions.Logging;
using Indexer2.Core;

namespace Indexer2.Services;

public class IndexDatabase : IDisposable
{
    private readonly string _connectionString;
    private readonly ILogger<IndexDatabase> _logger;
    private SQLiteConnection? _connection;

    public IndexDatabase(string databasePath, ILogger<IndexDatabase> logger)
    {
        _connectionString = $"Data Source={databasePath};Version=3;Journal Mode=WAL;Synchronous=NORMAL;Cache Size=10000;";
        _logger = logger;
        InitializeDatabase();
    }

    private void InitializeDatabase()
    {
        try
        {
            _connection = new SQLiteConnection(_connectionString);
            _connection.Open();

            // 创建文件索引表
            var createTableSql = @"
                CREATE TABLE IF NOT EXISTS file_entries (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    full_path TEXT NOT NULL UNIQUE,
                    file_name TEXT NOT NULL,
                    extension TEXT,
                    parent_path TEXT,
                    size INTEGER DEFAULT 0,
                    creation_time TEXT,
                    last_write_time TEXT,
                    last_access_time TEXT,
                    indexed_time TEXT,
                    is_directory BOOLEAN DEFAULT 0,
                    attributes INTEGER DEFAULT 0,
                    mime_type TEXT,
                    mft_record_number INTEGER DEFAULT 0
                );";

            using var command = new SQLiteCommand(createTableSql, _connection);
            command.ExecuteNonQuery();

            // 创建索引
            var createIndexesSql = @"
                CREATE INDEX IF NOT EXISTS idx_full_path ON file_entries(full_path);
                CREATE INDEX IF NOT EXISTS idx_parent_path ON file_entries(parent_path);
                CREATE INDEX IF NOT EXISTS idx_file_name ON file_entries(file_name);
                CREATE INDEX IF NOT EXISTS idx_extension ON file_entries(extension);
                CREATE INDEX IF NOT EXISTS idx_is_directory ON file_entries(is_directory);
                CREATE INDEX IF NOT EXISTS idx_mime_type ON file_entries(mime_type);
                CREATE INDEX IF NOT EXISTS idx_mft_record ON file_entries(mft_record_number);
            ";

            using var indexCommand = new SQLiteCommand(createIndexesSql, _connection);
            indexCommand.ExecuteNonQuery();

            // 创建元数据表
            var createMetadataTableSql = @"
                CREATE TABLE IF NOT EXISTS metadata (
                    key TEXT PRIMARY KEY,
                    value TEXT
                );";

            using var metadataCommand = new SQLiteCommand(createMetadataTableSql, _connection);
            metadataCommand.ExecuteNonQuery();

            _logger.LogInformation("Database initialized successfully at: {DatabasePath}", _connectionString);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to initialize database");
            throw;
        }
    }

    public void InsertFileEntries(IEnumerable<FileEntry> entries)
    {
        if (_connection == null)
            throw new InvalidOperationException("Database connection not initialized");

        using var transaction = _connection.BeginTransaction();
        try
        {
            var insertSql = @"
                INSERT OR REPLACE INTO file_entries (
                    full_path, file_name, extension, parent_path, size,
                    creation_time, last_write_time, last_access_time, indexed_time,
                    is_directory, attributes, mime_type, mft_record_number
                ) VALUES (
                    @full_path, @file_name, @extension, @parent_path, @size,
                    @creation_time, @last_write_time, @last_access_time, @indexed_time,
                    @is_directory, @attributes, @mime_type, @mft_record_number
                )";

            using var command = new SQLiteCommand(insertSql, _connection, transaction);
            
            foreach (var entry in entries)
            {
                command.Parameters.Clear();
                command.Parameters.AddWithValue("@full_path", entry.FullPath);
                command.Parameters.AddWithValue("@file_name", entry.FileName);
                command.Parameters.AddWithValue("@extension", entry.Extension ?? string.Empty);
                command.Parameters.AddWithValue("@parent_path", entry.ParentPath ?? string.Empty);
                command.Parameters.AddWithValue("@size", entry.Size);
                command.Parameters.AddWithValue("@creation_time", entry.CreationTime.ToString("O"));
                command.Parameters.AddWithValue("@last_write_time", entry.LastWriteTime.ToString("O"));
                command.Parameters.AddWithValue("@last_access_time", entry.LastAccessTime.ToString("O"));
                command.Parameters.AddWithValue("@indexed_time", entry.IndexedTime.ToString("O"));
                command.Parameters.AddWithValue("@is_directory", entry.IsDirectory);
                command.Parameters.AddWithValue("@attributes", (int)entry.Attributes);
                command.Parameters.AddWithValue("@mime_type", entry.MimeType ?? string.Empty);
                command.Parameters.AddWithValue("@mft_record_number", entry.MftRecordNumber);

                command.ExecuteNonQuery();
            }

            transaction.Commit();
        }
        catch (Exception ex)
        {
            transaction.Rollback();
            _logger.LogError(ex, "Failed to insert file entries");
            throw;
        }
    }

    public void InsertFileEntry(FileEntry entry)
    {
        InsertFileEntries(new[] { entry });
    }

    public FileEntry? GetEntry(string fullPath)
    {
        if (_connection == null)
            return null;

        var selectSql = @"
            SELECT full_path, file_name, extension, parent_path, size,
                   creation_time, last_write_time, last_access_time, indexed_time,
                   is_directory, attributes, mime_type, mft_record_number
            FROM file_entries 
            WHERE full_path = @full_path";

        using var command = new SQLiteCommand(selectSql, _connection);
        command.Parameters.AddWithValue("@full_path", fullPath);

        using var reader = command.ExecuteReader();
        if (reader.Read())
        {
            return ReadFileEntryFromReader(reader);
        }

        return null;
    }

    public List<FileEntry> GetEntriesByParent(string parentPath)
    {
        if (_connection == null)
            return new List<FileEntry>();

        var selectSql = @"
            SELECT full_path, file_name, extension, parent_path, size,
                   creation_time, last_write_time, last_access_time, indexed_time,
                   is_directory, attributes, mime_type, mft_record_number
            FROM file_entries 
            WHERE parent_path = @parent_path
            ORDER BY is_directory DESC, file_name ASC";

        var entries = new List<FileEntry>();
        using var command = new SQLiteCommand(selectSql, _connection);
        command.Parameters.AddWithValue("@parent_path", parentPath);

        using var reader = command.ExecuteReader();
        while (reader.Read())
        {
            entries.Add(ReadFileEntryFromReader(reader));
        }

        return entries;
    }

    public List<FileEntry> SearchEntries(string searchPattern, string? parentPath = null, bool recursive = true)
    {
        if (_connection == null)
            return new List<FileEntry>();

        var whereClause = "WHERE file_name LIKE @pattern";
        if (!string.IsNullOrEmpty(parentPath))
        {
            if (recursive)
            {
                whereClause += " AND (parent_path = @parent_path OR parent_path LIKE @parent_path_pattern)";
            }
            else
            {
                whereClause += " AND parent_path = @parent_path";
            }
        }

        var selectSql = $@"
            SELECT full_path, file_name, extension, parent_path, size,
                   creation_time, last_write_time, last_access_time, indexed_time,
                   is_directory, attributes, mime_type, mft_record_number
            FROM file_entries 
            {whereClause}
            ORDER BY is_directory DESC, file_name ASC
            LIMIT 1000";

        var entries = new List<FileEntry>();
        using var command = new SQLiteCommand(selectSql, _connection);
        command.Parameters.AddWithValue("@pattern", $"%{searchPattern}%");
        
        if (!string.IsNullOrEmpty(parentPath))
        {
            command.Parameters.AddWithValue("@parent_path", parentPath);
            if (recursive)
            {
                command.Parameters.AddWithValue("@parent_path_pattern", $"{parentPath}%");
            }
        }

        using var reader = command.ExecuteReader();
        while (reader.Read())
        {
            entries.Add(ReadFileEntryFromReader(reader));
        }

        return entries;
    }

    public void DeleteEntry(string fullPath)
    {
        if (_connection == null)
            return;

        var deleteSql = "DELETE FROM file_entries WHERE full_path = @full_path";
        using var command = new SQLiteCommand(deleteSql, _connection);
        command.Parameters.AddWithValue("@full_path", fullPath);
        command.ExecuteNonQuery();
    }

    public void DeleteEntriesWithPrefix(string pathPrefix)
    {
        if (_connection == null)
            return;

        var deleteSql = "DELETE FROM file_entries WHERE full_path LIKE @path_prefix";
        using var command = new SQLiteCommand(deleteSql, _connection);
        command.Parameters.AddWithValue("@path_prefix", $"{pathPrefix}%");
        command.ExecuteNonQuery();
    }

    public void ClearIndex()
    {
        if (_connection == null)
            return;

        var deleteSql = "DELETE FROM file_entries";
        using var command = new SQLiteCommand(deleteSql, _connection);
        command.ExecuteNonQuery();

        // 重建索引以释放空间
        var vacuumSql = "VACUUM";
        using var vacuumCommand = new SQLiteCommand(vacuumSql, _connection);
        vacuumCommand.ExecuteNonQuery();

        _logger.LogInformation("Index cleared and database vacuumed");
    }

    public string? GetMetadata(string key)
    {
        if (_connection == null)
            return null;

        var selectSql = "SELECT value FROM metadata WHERE key = @key";
        using var command = new SQLiteCommand(selectSql, _connection);
        command.Parameters.AddWithValue("@key", key);

        var result = command.ExecuteScalar();
        return result?.ToString();
    }

    public void UpdateMetadata(string key, string value)
    {
        if (_connection == null)
            return;

        var upsertSql = "INSERT OR REPLACE INTO metadata (key, value) VALUES (@key, @value)";
        using var command = new SQLiteCommand(upsertSql, _connection);
        command.Parameters.AddWithValue("@key", key);
        command.Parameters.AddWithValue("@value", value);
        command.ExecuteNonQuery();
    }

    public long GetTotalEntryCount()
    {
        if (_connection == null)
            return 0;

        var countSql = "SELECT COUNT(*) FROM file_entries";
        using var command = new SQLiteCommand(countSql, _connection);
        var result = command.ExecuteScalar();
        return result != null ? Convert.ToInt64(result) : 0;
    }

    public long GetDirectoryCount()
    {
        if (_connection == null)
            return 0;

        var countSql = "SELECT COUNT(*) FROM file_entries WHERE is_directory = 1";
        using var command = new SQLiteCommand(countSql, _connection);
        var result = command.ExecuteScalar();
        return result != null ? Convert.ToInt64(result) : 0;
    }

    public long GetFileCount()
    {
        if (_connection == null)
            return 0;

        var countSql = "SELECT COUNT(*) FROM file_entries WHERE is_directory = 0";
        using var command = new SQLiteCommand(countSql, _connection);
        var result = command.ExecuteScalar();
        return result != null ? Convert.ToInt64(result) : 0;
    }

    private FileEntry ReadFileEntryFromReader(SQLiteDataReader reader)
    {
        return new FileEntry
        {
            FullPath = reader.GetString("full_path"),
            FileName = reader.GetString("file_name"),
            Extension = reader.GetString("extension"),
            ParentPath = reader.GetString("parent_path"),
            Size = reader.GetInt64("size"),
            CreationTime = DateTime.Parse(reader.GetString("creation_time")),
            LastWriteTime = DateTime.Parse(reader.GetString("last_write_time")),
            LastAccessTime = DateTime.Parse(reader.GetString("last_access_time")),
            IndexedTime = DateTime.Parse(reader.GetString("indexed_time")),
            IsDirectory = reader.GetBoolean("is_directory"),
            Attributes = (FileAttributes)reader.GetInt32("attributes"),
            MimeType = reader.GetString("mime_type"),
            MftRecordNumber = (ulong)reader.GetInt64("mft_record_number")
        };
    }

    public void Dispose()
    {
        _connection?.Dispose();
        _logger.LogInformation("Database connection disposed");
    }
}
