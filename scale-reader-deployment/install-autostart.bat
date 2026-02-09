@echo off
echo ========================================
echo   Install Scale Reader Auto-Start
echo ========================================
echo.
echo This will make the scale reader start automatically when you log in.
echo.

:: Create a shortcut in the Windows Startup folder
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SCRIPT=%~dp0start-scale-reader.bat"

:: Use PowerShell to create a shortcut
powershell -Command "$ws = New-Object -ComObject WScript.Shell; $shortcut = $ws.CreateShortcut('%STARTUP%\Scale Reader.lnk'); $shortcut.TargetPath = '%SCRIPT%'; $shortcut.WorkingDirectory = '%~dp0'; $shortcut.WindowStyle = 7; $shortcut.Description = 'Rogue Origin Scale Reader'; $shortcut.Save()"

if %errorlevel% equ 0 (
    echo.
    echo Done! Scale reader will auto-start on login.
    echo Shortcut created in: %STARTUP%
    echo.
    echo To remove: delete "Scale Reader" from your Startup folder.
) else (
    echo.
    echo Failed to create shortcut. You can manually copy
    echo start-scale-reader.bat to your Startup folder:
    echo %STARTUP%
)

echo.
pause
