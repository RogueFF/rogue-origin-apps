@echo off
echo ========================================
echo   Install Scale Reader Auto-Start
echo ========================================
echo.
echo This will make the scale reader start automatically when you log in.
echo.

:: Check if the exe exists
if not exist "%~dp0dist\ScaleReader.exe" (
    echo ✗ ScaleReader.exe not found!
    echo.
    echo Please run build.bat first to create the executable.
    echo.
    pause
    exit /b 1
)

:: Create a shortcut in the Windows Startup folder
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "EXE=%~dp0dist\ScaleReader.exe"

:: Use PowerShell to create a shortcut
powershell -Command "$ws = New-Object -ComObject WScript.Shell; $shortcut = $ws.CreateShortcut('%STARTUP%\Rogue Origin Scale Reader.lnk'); $shortcut.TargetPath = '%EXE%'; $shortcut.WorkingDirectory = '%~dp0'; $shortcut.Description = 'Rogue Origin Scale Reader'; $shortcut.Save()"

if %errorlevel% equ 0 (
    echo.
    echo ✓ Done! Scale reader will auto-start on login.
    echo.
    echo Shortcut created in: %STARTUP%
    echo Target: %EXE%
    echo.
    echo To remove: delete "Rogue Origin Scale Reader" from your Startup folder.
) else (
    echo.
    echo ✗ Failed to create shortcut.
    echo.
    echo You can manually create a shortcut to:
    echo   %EXE%
    echo.
    echo And place it in: %STARTUP%
)

echo.
pause
