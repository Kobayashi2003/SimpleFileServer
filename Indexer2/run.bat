@echo off
set BASE_DIR=%1
set OUTPUT_DB=%2

if "%BASE_DIR%"=="" (
    echo Usage: run.bat ^<base-directory^> [output-database]
    echo Example: run.bat "D:\MyFiles" "myindex.db"
    pause
    exit /b 1
)

if "%OUTPUT_DB%"=="" (
    set OUTPUT_DB=index.db
)

echo Running Indexer2...
echo Base Directory: %BASE_DIR%
echo Output Database: %OUTPUT_DB%
echo.

bin\Release\net8.0\Indexer2.exe --base-directory "%BASE_DIR%" --output "%OUTPUT_DB%" --monitor --verbose

pause
