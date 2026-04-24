@echo off
echo ========================================
echo   Install Scale Reader Auto-Start (.bat)
echo ========================================
echo.
echo This will make the scale reader start automatically when you log in.
echo It runs start-scale-reader.bat, which pulls the latest code from git
echo and restarts on crash.
echo.

set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "BAT=%~dp0start-scale-reader.bat"

if not exist "%BAT%" (
    echo [X] start-scale-reader.bat not found at %BAT%
    pause
    exit /b 1
)

powershell -Command "$ws = New-Object -ComObject WScript.Shell; $shortcut = $ws.CreateShortcut('%STARTUP%\Rogue Origin Scale Reader.lnk'); $shortcut.TargetPath = '%BAT%'; $shortcut.WorkingDirectory = '%~dp0'; $shortcut.Description = 'Rogue Origin Scale Reader'; $shortcut.WindowStyle = 1; $shortcut.Save()"

if %errorlevel% equ 0 (
    echo.
    echo [OK] Scale reader will auto-start on next login.
    echo.
    echo Shortcut: %STARTUP%\Rogue Origin Scale Reader.lnk
    echo Target:   %BAT%
    echo.
    echo To test now without rebooting: double-click the shortcut, or run
    echo    start-scale-reader.bat
    echo.
    echo To remove: delete "Rogue Origin Scale Reader" from the Startup folder
    echo    (Win+R, type: shell:startup)
) else (
    echo.
    echo [X] Failed to create shortcut.
    echo    Manually create a shortcut to %BAT% in: %STARTUP%
)

echo.
pause
