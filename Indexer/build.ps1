# Build script for NTFS Indexer

param(
    [string]$Command = "build",
    [string]$Path = ".",
    [string]$SearchTerm = "",
    [int]$Limit = 50
)

# Stop on any error
$ErrorActionPreference = "Stop"

Write-Host "NTFS Indexer Build Script" -ForegroundColor Green
Write-Host "========================" -ForegroundColor Green

# Restore dependencies
Write-Host "Restoring dependencies..." -ForegroundColor Yellow
dotnet restore

# Build the project
Write-Host "Building project..." -ForegroundColor Yellow
dotnet build --configuration Release

if ($Command -eq "build") {
    Write-Host "Build completed successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Available commands:" -ForegroundColor Cyan
    Write-Host "  .\build.ps1 -Command build -Path <path>        # Build index for specified path"
    Write-Host "  .\build.ps1 -Command monitor -Path <path>      # Monitor file system changes"
    Write-Host "  .\build.ps1 -Command full -Path <path>         # Build index and start monitoring"
    Write-Host "  .\build.ps1 -Command search -SearchTerm <term> # Search indexed files"
    Write-Host "  .\build.ps1 -Command status                    # Show indexer status"
    Write-Host ""
    Write-Host "Examples:" -ForegroundColor Yellow
    Write-Host "  .\build.ps1 -Command build -Path 'D:\MyFiles'"
    Write-Host "  .\build.ps1 -Command search -SearchTerm 'photo'"
    Write-Host "  .\build.ps1 -Command full -Path 'C:\Users'"
} elseif ($Command -eq "run-build") {
    Write-Host "Running index build..." -ForegroundColor Green
    dotnet run --configuration Release -- build $Path
} elseif ($Command -eq "run-monitor") {
    Write-Host "Running file system monitor..." -ForegroundColor Green
    dotnet run --configuration Release -- monitor $Path
} elseif ($Command -eq "run-full") {
    Write-Host "Running full indexing (build + monitor)..." -ForegroundColor Green
    dotnet run --configuration Release -- full $Path
} elseif ($Command -eq "run-search") {
    if ([string]::IsNullOrEmpty($SearchTerm)) {
        Write-Host "Error: SearchTerm is required for search command" -ForegroundColor Red
        exit 1
    }
    Write-Host "Searching for: $SearchTerm" -ForegroundColor Green
    dotnet run --configuration Release -- search $SearchTerm --limit $Limit
} elseif ($Command -eq "run-status") {
    Write-Host "Showing indexer status..." -ForegroundColor Green
    dotnet run --configuration Release -- status
} else {
    Write-Host "Unknown command: $Command" -ForegroundColor Red
    Write-Host "Available commands: build, run-build, run-monitor, run-full, run-search, run-status" -ForegroundColor Yellow
    exit 1
}