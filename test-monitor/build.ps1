# Build script for NTFS Indexer

# Stop on any error
$ErrorActionPreference = "Stop"

Write-Host "Building NTFS Indexer..." -ForegroundColor Green

# Restore dependencies
Write-Host "Restoring dependencies..." -ForegroundColor Yellow
dotnet restore

# Build the project
Write-Host "Building project..." -ForegroundColor Yellow
dotnet build --configuration Release

# Run the application if -Run parameter is specified
if ($args[0] -eq "-Run") {
    Write-Host "Running application..." -ForegroundColor Green
    $path = if ($args[1]) { $args[1] } else { "." }
    dotnet run --configuration Release -- $path
}

Write-Host "Build completed successfully!" -ForegroundColor Green