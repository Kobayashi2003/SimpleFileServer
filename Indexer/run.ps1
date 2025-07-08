# NTFS Indexer Quick Run Script
param(
    [Parameter(Mandatory=$true)]
    [string]$Path
)

# Stop on any error
$ErrorActionPreference = "Stop"

Write-Host "NTFS Indexer - Quick Start" -ForegroundColor Green
Write-Host "=========================" -ForegroundColor Green
Write-Host "Path: $Path" -ForegroundColor Yellow

# Check if path exists
if (-not (Test-Path $Path)) {
    Write-Host "Error: Path '$Path' does not exist" -ForegroundColor Red
    exit 1
}

# Build and run full indexing (build + monitor)
Write-Host "Starting full indexing (build + monitor)..." -ForegroundColor Cyan
dotnet run --configuration Release -- full $Path