# HTML Validation Script for scoreboard.html
$projectRoot = 'C:\Users\Rogue\OneDrive\Desktop\Dev\rogue-origin-apps-master'
Set-Location $projectRoot
$html = Get-Content 'src/pages/scoreboard.html' -Raw

Write-Host ""
Write-Host "=== Scoreboard.html Validation ===" -ForegroundColor Cyan
Write-Host ""

# Check file size
$size = (Get-Item 'src/pages/scoreboard.html').Length / 1KB
$sizeColor = if($size -lt 100){'Green'}else{'Red'}
Write-Host "File size: $size KB" -ForegroundColor $sizeColor

# Check critical elements
$checks = @{
    'DOCTYPE present' = $html -match '<!DOCTYPE html>'
    'Main.js loaded' = $html -match 'main\.js'
    'Chart canvas exists' = $html -match 'id="hourlyChart"'
    'Timer display exists' = $html -match 'id="timerDisplay"'
    'Onclick handlers present' = $html -match 'onclick='
    'Language toggle exists' = $html -match 'setLanguage'
    'No inline script blocks' = ($html -split '<script>').Count -eq 1
}

foreach ($check in $checks.GetEnumerator()) {
    if($check.Value) {
        Write-Host "PASS - $($check.Key)" -ForegroundColor Green
    } else {
        Write-Host "FAIL - $($check.Key)" -ForegroundColor Red
    }
}

# Count external modules
$moduleCount = ([regex]::Matches($html, 'src="../js/scoreboard/')).Count
$moduleColor = if($moduleCount -ge 13){'Green'}else{'Yellow'}
Write-Host ""
Write-Host "External modules loaded: $moduleCount" -ForegroundColor $moduleColor

Write-Host ""
Write-Host "=== Server Status ===" -ForegroundColor Cyan
try {
    $response = Invoke-WebRequest -Uri 'http://localhost:8000/src/pages/scoreboard.html' -UseBasicParsing -TimeoutSec 2
    Write-Host "PASS - Server responding: HTTP $($response.StatusCode)" -ForegroundColor Green
    Write-Host "  Open: http://localhost:8000/src/pages/scoreboard.html" -ForegroundColor Cyan
} catch {
    Write-Host "FAIL - Server not responding" -ForegroundColor Red
    Write-Host "  Run: python -m http.server 8000" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== Next Steps ===" -ForegroundColor Cyan
Write-Host "1. Open http://localhost:8000/src/pages/scoreboard.html in browser"
Write-Host "2. Check browser console for errors (F12)"
Write-Host "3. Test all functionality (see OPTIMIZATION_TEST_RESULTS.md)"
Write-Host "4. Run Lighthouse audit"
Write-Host "5. If all tests pass, mark task complete"
Write-Host ""
