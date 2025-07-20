param(
    [Parameter(Mandatory=$true)]
    [string]$BaseDirectory,

    [string]$OutputDatabase = "index.db",

    [switch]$Force,

    [switch]$Monitor,

    [switch]$Verbose,

    [switch]$RelativePaths = $true
)

Write-Host "Running Indexer2..." -ForegroundColor Green
Write-Host "Base Directory: $BaseDirectory" -ForegroundColor Yellow
Write-Host "Output Database: $OutputDatabase" -ForegroundColor Yellow

$arguments = @(
    "--base-directory", "`"$BaseDirectory`""
    "--output", "`"$OutputDatabase`""
)

if ($Force) {
    $arguments += "--force"
    Write-Host "Force rebuild: Enabled" -ForegroundColor Yellow
}

if ($Monitor) {
    $arguments += "--monitor"
    Write-Host "Real-time monitoring: Enabled" -ForegroundColor Yellow
}

if ($Verbose) {
    $arguments += "--verbose"
    Write-Host "Verbose logging: Enabled" -ForegroundColor Yellow
}

if ($RelativePaths) {
    $arguments += "--relative-paths"
    Write-Host "Using relative paths: Enabled" -ForegroundColor Yellow
}

Write-Host ""

& "bin\Release\net8.0\Indexer2.exe" $arguments

if ($LASTEXITCODE -ne 0) {
    Write-Host "Indexer2 exited with error code: $LASTEXITCODE" -ForegroundColor Red
}

Read-Host "Press Enter to exit"
