@echo off
echo Building Indexer2...

dotnet build --configuration Release

if %ERRORLEVEL% neq 0 (
    echo Build failed!
    pause
    exit /b 1
)

echo Build completed successfully!
echo Executable location: bin\Release\net8.0\Indexer2.exe
pause
