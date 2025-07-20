# Indexer2

Indexer2 是一个高性能的文件索引器，使用类似 Everything 的策略来快速构建和维护文件索引。

## 特性

- **高性能索引构建**: 使用并行处理和批量数据库操作
- **快速 MIME 类型检测**: 基于扩展名的快速映射，避免文件内容检测
- **实时监控**: 使用 USN Journal（Windows）或 FileSystemWatcher 进行实时文件系统监控
- **路径过滤**: 只索引指定根目录下的文件，自动过滤根目录外的项目
- **相对路径支持**: 可选择使用相对路径或绝对路径存储
- **SQLite 数据库**: 使用 WAL 模式的 SQLite 数据库确保性能和可靠性

## 系统要求

- .NET 8.0 或更高版本
- Windows (推荐，可使用 USN Journal 监控)
- Linux/macOS (使用 FileSystemWatcher 作为回退)

## 构建

### Windows
```cmd
build.bat
```

### PowerShell/跨平台
```powershell
./build.ps1
```

或者直接使用 .NET CLI:
```bash
dotnet build --configuration Release
```

## 使用方法

### 基本用法
```cmd
Indexer2.exe --base-directory "C:\MyFiles" --output "myfiles.db"
```

### 带监控的用法
```cmd
Indexer2.exe --base-directory "C:\MyFiles" --output "myfiles.db" --monitor
```

### PowerShell 脚本
```powershell
./run.ps1 -BaseDirectory "C:\MyFiles" -OutputDatabase "myfiles.db" -Monitor -Verbose
```

## 命令行参数

| 参数 | 描述 | 必需 | 默认值 |
|------|------|------|--------|
| `--base-directory` | 要索引的根目录 | ✅ | - |
| `--output` | 输出数据库文件路径 | ❌ | `index.db` |
| `--force` | 强制重建索引 | ❌ | `false` |
| `--monitor` | 启用实时监控 | ❌ | `false` |
| `--relative-paths` | 使用相对路径 | ❌ | `true` |
| `--verbose` | 启用详细日志 | ❌ | `false` |

## 性能优化

### MIME 类型检测
Indexer2 使用预定义的扩展名到 MIME 类型映射表，避免了耗时的文件内容分析。支持的文件类型包括：

- **文本文件**: .txt, .log, .json, .xml, .html, .css, .js, .md 等
- **图片文件**: .jpg, .png, .gif, .bmp, .webp, .svg, .psd 等
- **音频文件**: .mp3, .wav, .flac, .aac, .ogg, .m4a 等
- **视频文件**: .mp4, .avi, .mkv, .mov, .wmv, .flv 等
- **文档文件**: .pdf, .doc, .docx, .xls, .xlsx, .ppt, .pptx 等
- **压缩文件**: .zip, .rar, .7z, .tar, .gz 等
- **程序文件**: .exe, .dll, .msi 等
- **开发文件**: .cs, .java, .py, .cpp, .js, .ts 等

### 批量处理
- 使用批量数据库插入操作（默认批次大小：10,000）
- 并行文件处理（默认并发数：CPU 核心数 × 2）
- 内存中缓存待处理项目，减少 I/O 操作

### 数据库优化
- SQLite WAL 模式，提高并发性能
- 优化的索引策略
- 定期批量提交事务

## 监控策略

### Windows (USN Journal)
在 Windows 系统上，Indexer2 会尝试使用 NTFS 的 Update Sequence Number (USN) Journal 进行高效的文件系统监控。USN Journal 提供：

- 卷级别的文件变更通知
- 比 FileSystemWatcher 更高的性能
- 更可靠的事件捕获

### 跨平台 (FileSystemWatcher)
当 USN Journal 不可用时，会回退到使用 .NET 的 FileSystemWatcher：

- 递归监控指定目录
- 实时捕获文件创建、修改、删除和重命名事件
- 自动过滤根目录外的变更

## 路径过滤

Indexer2 会自动过滤根目录外的文件和文件夹：

- 只索引 `--base-directory` 参数指定目录及其子目录下的项目
- 监控期间自动忽略根目录外的文件系统事件
- 支持相对路径模式，减少存储空间

## 数据库结构

索引数据存储在 SQLite 数据库中，主要表结构：

### file_entries 表
- `full_path`: 文件完整路径（主键）
- `file_name`: 文件名
- `extension`: 文件扩展名
- `parent_path`: 父目录路径
- `size`: 文件大小
- `creation_time`: 创建时间
- `last_write_time`: 最后修改时间
- `last_access_time`: 最后访问时间
- `indexed_time`: 索引时间
- `is_directory`: 是否为目录
- `attributes`: 文件属性
- `mime_type`: MIME 类型
- `mft_record_number`: MFT 记录号（Windows）

### metadata 表
- `key`: 元数据键
- `value`: 元数据值

存储索引构建信息，如最后构建时间、根目录路径等。

## 示例

### 构建基本索引
```cmd
Indexer2.exe --base-directory "D:\Documents" --output "documents.db"
```

### 强制重建并启用监控
```cmd
Indexer2.exe --base-directory "D:\Documents" --output "documents.db" --force --monitor --verbose
```

### 使用绝对路径
```cmd
Indexer2.exe --base-directory "D:\Documents" --output "documents.db" --relative-paths false
```

## 与原版 Indexer 的区别

| 特性 | 原版 Indexer | Indexer2 |
|------|-------------|----------|
| MIME 检测 | 基于文件内容分析 | 基于扩展名映射 |
| 监控策略 | FileSystemWatcher | USN Journal + FileSystemWatcher |
| 并发处理 | 有限 | 高度并行化 |
| 批量操作 | 小批次 | 大批次优化 |
| 路径过滤 | 需要额外配置 | 自动过滤 |
| 性能 | 中等 | 高性能 |

## 注意事项

1. **管理员权限**: 在 Windows 上使用 USN Journal 监控可能需要管理员权限
2. **磁盘空间**: 大型目录的索引可能产生较大的数据库文件
3. **初始构建**: 首次构建大型目录索引可能需要较长时间
4. **监控模式**: 启用监控模式时，程序会持续运行直到手动停止

## 故障排除

### 常见问题

**Q: 提示权限不足**
A: 尝试以管理员身份运行，或检查目标目录的访问权限

**Q: 索引速度缓慢**
A: 检查磁盘 I/O 性能，考虑将数据库文件放在 SSD 上

**Q: 监控不工作**
A: 确保目标目录存在且可访问，检查防病毒软件是否阻止文件系统监控

**Q: 数据库文件过大**
A: 考虑使用相对路径模式，或定期清理不需要的索引数据
