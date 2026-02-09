/**
 * Scale Reader Launcher
 * 
 * Handles auto-update from git and process management for the scale reader.
 * Compiled into ScaleReader.exe via pkg.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Console window title
process.title = 'Rogue Origin Scale Reader';

console.log('\n========================================');
console.log('  Rogue Origin Scale Reader v1.0');
console.log('========================================\n');

// Determine if we're running as packaged exe or in dev mode
const isPkg = typeof process.pkg !== 'undefined';
const rootDir = isPkg ? path.dirname(process.execPath) : __dirname;

console.log(`Working directory: ${rootDir}`);
console.log(`Running mode: ${isPkg ? 'PACKAGED' : 'DEV'}\n`);

// Git auto-update on startup
async function autoUpdate() {
  return new Promise((resolve) => {
    console.log('Checking for updates from git...');
    
    const gitPull = spawn('git', ['pull'], {
      cwd: rootDir,
      shell: true,
      stdio: 'pipe'
    });

    let output = '';
    
    gitPull.stdout.on('data', (data) => {
      output += data.toString();
    });

    gitPull.stderr.on('data', (data) => {
      output += data.toString();
    });

    gitPull.on('close', (code) => {
      if (code === 0) {
        if (output.includes('Already up to date')) {
          console.log('✓ Already up to date\n');
        } else {
          console.log('✓ Updated to latest version\n');
          console.log(output.trim() + '\n');
        }
      } else {
        console.log('⚠ No git repo or offline - running current version\n');
      }
      resolve();
    });

    // Timeout after 10 seconds
    setTimeout(() => {
      try {
        gitPull.kill();
      } catch (e) {}
      console.log('⚠ Git pull timed out - continuing with current version\n');
      resolve();
    }, 10000);
  });
}

// Start the scale reader as a child process
let childProcess = null;
let isShuttingDown = false;
let restartTimer = null;

function startScaleReader() {
  if (isShuttingDown) return;

  console.log('Starting scale reader...');
  console.log('─────────────────────────────────────\n');

  // Use node to run index.js (which gets bundled by pkg)
  // In packaged mode, we need to use the bundled Node.js
  const nodeExe = process.execPath;
  const scriptPath = path.join(rootDir, 'index.js');

  // Check if we're in packaged mode - if so, we need to extract the script
  let args;
  if (isPkg) {
    // In pkg mode, the index.js is bundled. We'll spawn node with the bundled script.
    // pkg will handle the require() calls internally
    args = [scriptPath];
  } else {
    args = [scriptPath];
  }

  childProcess = spawn(nodeExe, args, {
    cwd: rootDir,
    stdio: 'inherit',
    shell: false,
    env: {
      ...process.env,
      NODE_ENV: 'production'
    }
  });

  childProcess.on('exit', (code, signal) => {
    if (isShuttingDown) {
      console.log('\n✓ Scale reader stopped cleanly');
      process.exit(0);
    } else {
      console.log(`\n⚠ Scale reader exited unexpectedly (code: ${code}, signal: ${signal})`);
      scheduleRestart();
    }
  });

  childProcess.on('error', (err) => {
    console.error(`\n✗ Failed to start scale reader: ${err.message}`);
    scheduleRestart();
  });
}

function scheduleRestart() {
  if (isShuttingDown) return;
  if (restartTimer) return; // Already scheduled

  console.log('Restarting in 5 seconds...');
  console.log('Press Ctrl+C to exit\n');

  restartTimer = setTimeout(() => {
    restartTimer = null;
    startScaleReader();
  }, 5000);
}

// Graceful shutdown handler
function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n\nReceived ${signal} - shutting down gracefully...`);

  // Clear any pending restart
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }

  // Kill child process if running
  if (childProcess && !childProcess.killed) {
    console.log('Stopping scale reader...');
    
    // Try SIGINT first (graceful)
    childProcess.kill('SIGINT');

    // Force kill after 5 seconds if still running
    setTimeout(() => {
      if (childProcess && !childProcess.killed) {
        console.log('Force killing scale reader...');
        childProcess.kill('SIGKILL');
      }
    }, 5000);
  } else {
    process.exit(0);
  }
}

// Register shutdown handlers
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGHUP', () => shutdown('SIGHUP'));

// Handle Windows Ctrl+C
if (process.platform === 'win32') {
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.on('SIGINT', () => {
    process.emit('SIGINT');
  });
}

// Main entry point
(async function main() {
  try {
    // Step 1: Auto-update from git
    await autoUpdate();

    // Step 2: Check for node_modules (in case of first run after update)
    const nodeModulesPath = path.join(rootDir, 'node_modules');
    if (!fs.existsSync(nodeModulesPath)) {
      console.log('⚠ node_modules not found. Run "npm install" first.\n');
      console.log('The executable assumes dependencies are already installed.');
      console.log('Press any key to exit...');
      process.stdin.once('data', () => process.exit(1));
      return;
    }

    // Step 3: Start the scale reader
    startScaleReader();

  } catch (error) {
    console.error('✗ Fatal error:', error.message);
    process.exit(1);
  }
})();
