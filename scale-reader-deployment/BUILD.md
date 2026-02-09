# Building the Scale Reader Executable

The scale reader can be packaged as a standalone Windows executable using [pkg](https://github.com/vercel/pkg).

## Quick Start

On the Windows PC where the scale is connected:

```batch
build.bat
```

This will:
1. Install all Node.js dependencies
2. Install the `pkg` tool
3. Build `dist/ScaleReader.exe`

## What the Executable Does

`ScaleReader.exe` is a wrapper that:

1. **Auto-updates on launch** - Runs `git pull` to grab the latest code
2. **Starts the scale reader** - Spawns `index.js` as a child process
3. **Auto-restarts on crash** - If the scale reader crashes, restarts after 5 seconds
4. **Clean console window** - Shows "Rogue Origin Scale Reader" as the window title
5. **Graceful shutdown** - Handles Ctrl+C properly

## Installation

After building:

```batch
install-autostart.bat
```

This creates a shortcut in your Windows Startup folder so the scale reader launches automatically on login.

## Manual Run

To run the scale reader manually:

```batch
cd dist
ScaleReader.exe
```

## Directory Structure

```
scale-reader-deployment/
├── launcher.js          ← Main wrapper (auto-update + process management)
├── index.js             ← Actual scale reader logic
├── package.json         ← Includes pkg config
├── build.bat            ← Build script for Windows
├── install-autostart.bat ← Auto-start installer
└── dist/
    └── ScaleReader.exe  ← Built executable
```

## Cross-Compilation (Linux → Windows)

You can build the Windows executable from Linux (WSL/Ubuntu):

```bash
npm install
npm run build
```

The resulting `dist/ScaleReader.exe` can be copied to the Windows PC.

## Updating the Scale Reader

The exe auto-updates from git on every launch, so you can push changes to the repo and they'll be pulled next time the exe runs.

**Important:** The exe itself doesn't auto-update — only the Node.js code it wraps. If you change `launcher.js` or `package.json`, you need to rebuild the exe and redistribute it.

## Dependencies

The exe bundles Node.js and most dependencies, but **node_modules must exist** in the same directory as the exe. This is because some native modules (like `serialport`) can't be fully bundled by pkg.

So the deployment structure is:

```
C:\RogueOrigin\scale-reader\
├── ScaleReader.exe       ← The launcher
├── index.js              ← Scale reader code
├── package.json
├── node_modules/         ← Must be present!
└── public/               ← Web UI files
```

## Troubleshooting

**"node_modules not found"**
- Run `npm install` in the scale reader directory

**Exe doesn't auto-update**
- Make sure the directory is a git repository
- Check internet connectivity
- The exe will continue with the current version if git fails

**Scale reader crashes immediately**
- Check that the COM port is correct (default: COM3)
- Verify the scale is connected and powered on
- Try running `node index.js --mock` to test without the scale

**Auto-start doesn't work**
- Check Windows Startup folder: `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`
- Verify the shortcut points to the correct exe path
- Make sure the working directory is set correctly

## Development Workflow

1. Make changes to `index.js`, `launcher.js`, etc.
2. Commit and push to GitHub
3. On the Windows PC, the exe will auto-pull on next launch
4. If you changed `launcher.js`, rebuild and redeploy the exe

## Build Configuration

The build is configured in `package.json`:

```json
{
  "pkg": {
    "scripts": ["index.js"],
    "assets": [
      "public/**/*",
      "node_modules/serialport/**/*",
      "node_modules/@serialport/**/*"
    ],
    "targets": ["node18-win-x64"],
    "outputPath": "dist"
  }
}
```

- **scripts** - Additional scripts to bundle
- **assets** - Files to include in the executable
- **targets** - Platform/architecture (Windows x64, Node 18)
- **outputPath** - Where to put the built exe
