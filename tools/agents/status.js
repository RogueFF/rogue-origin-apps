/**
 * Agent Status Reporter — updates agent status in Mission Control API
 * Usage:
 *   const { agentStart, agentDone, agentError } = require('../status');
 *   await agentStart('dealer', 'Scanning 4 positions...');
 *   // ... do work ...
 *   await agentDone('dealer', 'Last run: 4 scanned, 0 closed');
 */

const API_BASE = 'https://mission-control-api.roguefamilyfarms.workers.dev/api';

async function updateAgent(name, status, task) {
  try {
    await fetch(`${API_BASE}/agents/${name}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, current_task: task }),
    });
  } catch (_) {
    // Silent fail — status updates are best-effort, never block the agent
  }
}

async function agentStart(name, task) {
  await updateAgent(name, 'active', task);
}

async function agentDone(name, summary) {
  await updateAgent(name, 'idle', summary || null);
}

async function agentError(name, error) {
  await updateAgent(name, 'error', `Error: ${String(error).slice(0, 200)}`);
}

module.exports = { agentStart, agentDone, agentError };
