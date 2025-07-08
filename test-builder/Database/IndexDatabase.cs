using Microsoft.Data.Sqlite;
using IndexBuilder.Models;

namespace IndexBuilder.Database;

public class IndexDatabase : IDisposable
{
    private readonly SqliteConnection _connection;
    private bool _disposed;

    public IndexDatabase(string dbPath)
    {
        var connectionStringBuilder = new SqliteConnectionStringBuilder
        {
            DataSource = dbPath,
            Mode = SqliteOpenMode.ReadWriteCreate
        };

        _connection = new SqliteConnection(connectionStringBuilder.ConnectionString);
        _connection.Open();

        InitializeDatabase();
    }

    private void InitializeDatabase()
    {
        using var command = _connection.CreateCommand();
        command.CommandText = @"
            CREATE TABLE IF NOT EXISTS FileEntries (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                FullPath TEXT NOT NULL UNIQUE,
                FileName TEXT NOT NULL,
                Extension TEXT,
                Size INTEGER,
                CreationTime TEXT NOT NULL,
                LastWriteTime TEXT NOT NULL,
                LastAccessTime TEXT NOT NULL,
                FileHash TEXT,
                IsDirectory INTEGER NOT NULL,
                ParentPath TEXT,
                Attributes INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_fullpath ON FileEntries(FullPath);
            CREATE INDEX IF NOT EXISTS idx_filename ON FileEntries(FileName);
            CREATE INDEX IF NOT EXISTS idx_extension ON FileEntries(Extension);
            CREATE INDEX IF NOT EXISTS idx_parent ON FileEntries(ParentPath);
        ";
        command.ExecuteNonQuery();
    }

    public void InsertFileEntry(FileEntry entry)
    {
        using var command = _connection.CreateCommand();
        command.CommandText = @"
            INSERT OR REPLACE INTO FileEntries 
            (FullPath, FileName, Extension, Size, CreationTime, LastWriteTime, LastAccessTime, 
             FileHash, IsDirectory, ParentPath, Attributes)
            VALUES 
            (@FullPath, @FileName, @Extension, @Size, @CreationTime, @LastWriteTime, @LastAccessTime,
             @FileHash, @IsDirectory, @ParentPath, @Attributes)";

        command.Parameters.AddWithValue("@FullPath", entry.FullPath);
        command.Parameters.AddWithValue("@FileName", entry.FileName);
        command.Parameters.AddWithValue("@Extension", entry.Extension);
        command.Parameters.AddWithValue("@Size", entry.Size);
        command.Parameters.AddWithValue("@CreationTime", entry.CreationTime.ToString("O"));
        command.Parameters.AddWithValue("@LastWriteTime", entry.LastWriteTime.ToString("O"));
        command.Parameters.AddWithValue("@LastAccessTime", entry.LastAccessTime.ToString("O"));
        command.Parameters.AddWithValue("@FileHash", entry.FileHash ?? (object)DBNull.Value);
        command.Parameters.AddWithValue("@IsDirectory", entry.IsDirectory ? 1 : 0);
        command.Parameters.AddWithValue("@ParentPath", entry.ParentPath ?? (object)DBNull.Value);
        command.Parameters.AddWithValue("@Attributes", (int)entry.Attributes);

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
        }
        catch
        {
            transaction.Rollback();
            throw;
        }
    }

    public void DeleteEntry(string fullPath)
    {
        using var command = _connection.CreateCommand();
        command.CommandText = "DELETE FROM FileEntries WHERE FullPath = @FullPath";
        command.Parameters.AddWithValue("@FullPath", fullPath);
        command.ExecuteNonQuery();
    }

    public FileEntry? GetEntry(string fullPath)
    {
        using var command = _connection.CreateCommand();
        command.CommandText = "SELECT * FROM FileEntries WHERE FullPath = @FullPath";
        command.Parameters.AddWithValue("@FullPath", fullPath);

        using var reader = command.ExecuteReader();
        if (!reader.Read()) return null;

        return new FileEntry
        {
            Id = reader.GetInt64(0),
            FullPath = reader.GetString(1),
            FileName = reader.GetString(2),
            Extension = reader.IsDBNull(3) ? string.Empty : reader.GetString(3),
            Size = reader.GetInt64(4),
            CreationTime = DateTime.Parse(reader.GetString(5)),
            LastWriteTime = DateTime.Parse(reader.GetString(6)),
            LastAccessTime = DateTime.Parse(reader.GetString(7)),
            FileHash = reader.IsDBNull(8) ? null : reader.GetString(8),
            IsDirectory = reader.GetInt32(9) == 1,
            ParentPath = reader.IsDBNull(10) ? null : reader.GetString(10),
            Attributes = (FileAttributes)reader.GetInt32(11)
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