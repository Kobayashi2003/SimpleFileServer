Write-Host "Building Indexer2..." -ForegroundColor Green

dotnet build --configuration Release

if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed!" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "Build completed successfully!" -ForegroundColor Green
Write-Host "Executable location: bin\Release\net8.0\Indexer2.exe" -ForegroundColor Yellow
Read-Host "Press Enter to exit"
