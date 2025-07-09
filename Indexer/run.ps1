# NTFS Indexer Quick Run Script
param(
    [Parameter(Mandatory=$true)]
    [string]$Path,

    [Parameter(Mandatory=$false)]
    [ValidateSet('full', 'index', 'monitor')]
    [string]$Mode = 'full',

    [Parameter(Mandatory=$false)]
    [switch]$Force
)

# Stop on any error
$ErrorActionPreference = "Stop"

Write-Host "NTFS Indexer - Quick Start" -ForegroundColor Green
Write-Host "=========================" -ForegroundColor Green
Write-Host "Path: $Path" -ForegroundColor Yellow
Write-Host "Mode: $Mode" -ForegroundColor Yellow
if ($Force) {
    Write-Host "Force: Enabled (will rebuild without confirmation)" -ForegroundColor Yellow
}

# Check if path exists
if (-not (Test-Path $Path)) {
    Write-Host "Error: Path '$Path' does not exist" -ForegroundColor Red
    exit 1
}

# Build command arguments
$args = @($Mode, $Path)
if ($Force -and ($Mode -eq 'full' -or $Mode -eq 'index')) {
    $args += '--force'
}

# Run based on selected mode
Write-Host "Starting $Mode mode..." -ForegroundColor Cyan
dotnet run --configuration Release -- @args