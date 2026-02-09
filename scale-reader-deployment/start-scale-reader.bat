@echo off
title Rogue Origin Scale Reader
echo ========================================
echo   Rogue Origin Scale Reader - Auto Start
echo ========================================
echo.

:: Navigate to the scale reader directory
cd /d "%~dp0"

:: Pull latest from git
echo Checking for updates...
git pull 2>nul
if %errorlevel% equ 0 (
    echo Updated to latest version.
) else (
    echo No git repo or offline - running current version.
)
echo.

:: Install/update dependencies if needed
if not exist node_modules (
    echo Installing dependencies...
    npm install
    echo.
)

:: Start the scale reader
echo Starting scale reader...
echo Press Ctrl+C to stop.
echo.
npm start

:: If it crashes, wait and restart
echo.
echo Scale reader stopped. Restarting in 10 seconds...
echo Press Ctrl+C to exit.
timeout /t 10 /nobreak
goto :restart

:restart
echo Restarting...
npm start
goto :restart
