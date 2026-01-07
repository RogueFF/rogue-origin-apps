# Automated Dashboard Test Report

**Date:** 2026-01-04T08:52:29.887Z

## Summary

- ✅ Passed: 1
- ❌ Failed: 2
- ⚠️ Warnings: 0

## ❌ Failed Tests

### Settings Panel
**Message:** Panel is not properly positioned

**Details:**
```json
{
  "isVisible": true,
  "isOnScreen": false,
  "position": {
    "top": 0,
    "right": 2240,
    "width": 320,
    "height": 1080
  },
  "viewportWidth": 1920,
  "viewportHeight": 1080
}
```

### Test Suite
**Message:** Unexpected error occurred

**Details:**
```json
{
  "error": "Runtime.callFunctionOn timed out. Increase the 'protocolTimeout' setting in launch/connect calls for a higher timeout if needed.",
  "stack": "ProtocolError: Runtime.callFunctionOn timed out. Increase the 'protocolTimeout' setting in launch/connect calls for a higher timeout if needed.\n    at <instance_members_initializer> (C:\\Users\\Rogue\\OneDrive\\Desktop\\rogue-origin-apps-main\\node_modules\\puppeteer-core\\lib\\cjs\\puppeteer\\common\\CallbackRegistry.js:103:14)\n    at new Callback (C:\\Users\\Rogue\\OneDrive\\Desktop\\rogue-origin-apps-main\\node_modules\\puppeteer-core\\lib\\cjs\\puppeteer\\common\\CallbackRegistry.js:107:16)\n    at CallbackRegistry.create (C:\\Users\\Rogue\\OneDrive\\Desktop\\rogue-origin-apps-main\\node_modules\\puppeteer-core\\lib\\cjs\\puppeteer\\common\\CallbackRegistry.js:25:26)\n    at Connection._rawSend (C:\\Users\\Rogue\\OneDrive\\Desktop\\rogue-origin-apps-main\\node_modules\\puppeteer-core\\lib\\cjs\\puppeteer\\cdp\\Connection.js:108:26)\n    at CdpCDPSession.send (C:\\Users\\Rogue\\OneDrive\\Desktop\\rogue-origin-apps-main\\node_modules\\puppeteer-core\\lib\\cjs\\puppeteer\\cdp\\CdpSession.js:74:33)\n    at #evaluate (C:\\Users\\Rogue\\OneDrive\\Desktop\\rogue-origin-apps-main\\node_modules\\puppeteer-core\\lib\\cjs\\puppeteer\\cdp\\ExecutionContext.js:363:50)\n    at ExecutionContext.evaluate (C:\\Users\\Rogue\\OneDrive\\Desktop\\rogue-origin-apps-main\\node_modules\\puppeteer-core\\lib\\cjs\\puppeteer\\cdp\\ExecutionContext.js:277:36)\n    at IsolatedWorld.evaluate (C:\\Users\\Rogue\\OneDrive\\Desktop\\rogue-origin-apps-main\\node_modules\\puppeteer-core\\lib\\cjs\\puppeteer\\cdp\\IsolatedWorld.js:100:30)\n    at CdpJSHandle.evaluate (C:\\Users\\Rogue\\OneDrive\\Desktop\\rogue-origin-apps-main\\node_modules\\puppeteer-core\\lib\\cjs\\puppeteer\\api\\JSHandle.js:149:37)\n    at CdpElementHandle.evaluate (C:\\Users\\Rogue\\OneDrive\\Desktop\\rogue-origin-apps-main\\node_modules\\puppeteer-core\\lib\\cjs\\puppeteer\\api\\ElementHandle.js:347:38)"
}
```

## ✅ Passed Tests

- **Initial Layout:** No overlapping widgets detected
