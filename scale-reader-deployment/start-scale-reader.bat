@echo off
REM Scale Reader - Windows Startup Script
REM Starts the scale reader and keeps it running

echo ========================================
echo  Rogue Origin - Scale Reader
echo ========================================
echo.

REM Change to the script's directory
cd /d "%~dp0"

REM Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js is not installed!
    echo Please install Node.js from https://nodejs.org/
    echo.
    pause
    exit /b 1
)

REM Check if node_modules exists
if not exist "node_modules\" (
    echo Installing dependencies...
    call npm install
    echo.
)

REM Create logs directory if it doesn't exist
if not exist "logs\" mkdir logs

echo Starting Scale Reader...
echo.
echo Local Display: http://localhost:3000
echo Press Ctrl+C to stop
echo.
echo Logs are being written to: logs\scale-reader.log
echo ========================================
echo.

REM Start the scale reader
REM Logs both to console and file
node index.js 2>&1 | tee logs\scale-reader.log

REM If it exits, wait before closing
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ========================================
    echo ERROR: Scale Reader stopped unexpectedly
    echo Check logs\scale-reader.log for details
    echo ========================================
    pause
)
