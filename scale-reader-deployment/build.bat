@echo off
echo ========================================
echo   Building Rogue Origin Scale Reader
echo ========================================
echo.

:: Navigate to the scale reader directory
cd /d "%~dp0"

:: Step 1: Install dependencies
echo [1/3] Installing dependencies...
echo.
call npm install
if %errorlevel% neq 0 (
    echo.
    echo ✗ npm install failed
    pause
    exit /b 1
)

echo.
echo [2/3] Installing pkg (if needed)...
echo.
call npm install --save-dev pkg
if %errorlevel% neq 0 (
    echo.
    echo ✗ Failed to install pkg
    pause
    exit /b 1
)

echo.
echo [3/3] Building Windows executable...
echo.
call npm run build
if %errorlevel% neq 0 (
    echo.
    echo ✗ Build failed
    pause
    exit /b 1
)

echo.
echo ========================================
echo   ✓ Build complete!
echo ========================================
echo.
echo Executable created at: dist\ScaleReader.exe
echo.
echo You can now:
echo   1. Run dist\ScaleReader.exe directly
echo   2. Run install-autostart.bat to set up auto-start
echo.
pause
