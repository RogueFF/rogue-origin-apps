$body = @{
    id = 'roa-bug-crit2'
    boardId = 'dev'
    status = 'review'
    fernStatus = 'done'
    fernNotes = 'Fixed memory leak: Created centralized event-cleanup.js module. Updated modules/navigation.js, modules/index.js, orders/index.js to use registerEventListener with automatic cleanup. Added test suite. All 47 addEventListener calls now tracked and cleaned up properly. See docs/EVENT_CLEANUP_FIX.md for details.'
} | ConvertTo-Json

$response = Invoke-RestMethod -Uri 'https://muda-api.roguefamilyfarms.workers.dev/api/tasks/roa-bug-crit2' -Method PUT -Body $body -ContentType 'application/json'

Write-Output $response
