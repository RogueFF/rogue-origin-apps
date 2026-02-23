#!/usr/bin/env node
/**
 * extract-comms.js — Scan OpenClaw session logs for inter-agent communication
 * Outputs comms-data.json for the Agent Comms Dashboard
 */

const fs = require('fs');
const path = require('path');

const AGENTS_DIR = '/home/atlas/.openclaw/agents';
const OUTPUT = path.join(__dirname, 'site', 'comms-data.json');

function parseSessionKey(key) {
  // agent:main:main -> main
  // agent:hex:main -> hex
  // agent:razor:telegram:group:... -> razor
  if (!key) return 'unknown';
  const parts = key.split(':');
  if (parts[0] === 'agent' && parts.length >= 2) return parts[1];
  return key;
}

function truncate(str, len = 120) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len) + '...' : str;
}

function classifyMessage(text) {
  if (!text) return 'report';
  const lower = text.toLowerCase();
  if (lower.includes('escalat') || lower.includes('critical') || lower.includes('alert') || lower.includes('broken') || lower.includes('failed')) return 'escalation';
  if (lower.includes('request') || lower.includes('priority') || lower.includes('build') || lower.includes('need')) return 'request';
  if (lower.includes('complete') || lower.includes('deployed') || lower.includes('done') || lower.includes('shipped')) return 'completion';
  return 'report';
}

function extractComms() {
  const messages = [];
  const agentDirs = fs.readdirSync(AGENTS_DIR).filter(d => {
    const sessDir = path.join(AGENTS_DIR, d, 'sessions');
    return fs.existsSync(sessDir) && fs.statSync(sessDir).isDirectory();
  });

  for (const agentId of agentDirs) {
    const sessDir = path.join(AGENTS_DIR, agentId, 'sessions');
    const files = fs.readdirSync(sessDir).filter(f => f.endsWith('.jsonl'));

    for (const file of files) {
      const filepath = path.join(sessDir, file);
      let lines;
      try {
        lines = fs.readFileSync(filepath, 'utf-8').split('\n').filter(Boolean);
      } catch { continue; }

      for (const line of lines) {
        let entry;
        try { entry = JSON.parse(line); } catch { continue; }

        if (entry.type !== 'message' || !entry.message) continue;

        // 1. Outgoing: sessions_send tool calls
        if (entry.message.role === 'assistant' && entry.message.content) {
          const contents = Array.isArray(entry.message.content) ? entry.message.content : [entry.message.content];
          for (const c of contents) {
            if (c.type === 'toolCall' && c.name === 'sessions_send' && c.arguments) {
              const args = c.arguments;
              const targetAgent = parseSessionKey(args.sessionKey || args.label || '');
              messages.push({
                timestamp: entry.timestamp || entry.message.timestamp,
                from: agentId,
                to: targetAgent,
                message: args.message || '',
                preview: truncate(args.message),
                type: classifyMessage(args.message),
                direction: 'outgoing',
                status: 'sent', // will be updated by result
                toolCallId: c.id,
                sessionFile: file,
              });
            }
          }
        }

        // 2. Tool results for sessions_send
        if (entry.message.role === 'toolResult' && entry.message.toolName === 'sessions_send') {
          const details = entry.message.details || {};
          const status = details.status || 'unknown';
          // Find matching outgoing message by toolCallId
          const callId = entry.message.toolCallId;
          const match = messages.find(m => m.toolCallId === callId);
          if (match) {
            match.status = status === 'timeout' ? 'sent' : status; // timeout usually means delivered
            match.resultTimestamp = entry.timestamp;
          }
        }

        // 3. Incoming: inter-session messages
        if (entry.message.role === 'user' && entry.message.provenance && entry.message.provenance.kind === 'inter_session') {
          const prov = entry.message.provenance;
          const sourceAgent = parseSessionKey(prov.sourceSessionKey || '');
          const text = typeof entry.message.content === 'string' ? entry.message.content :
            (Array.isArray(entry.message.content) ? entry.message.content.map(c => c.text || '').join('') : '');
          messages.push({
            timestamp: entry.timestamp || entry.message.timestamp,
            from: sourceAgent,
            to: agentId,
            message: text,
            preview: truncate(text),
            type: classifyMessage(text),
            direction: 'incoming',
            status: 'delivered',
            sessionFile: file,
          });
        }
      }
    }
  }

  // Sort by timestamp
  messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  // Build aggregations
  const agentStats = {};
  const edgeMap = {};
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  for (const msg of messages) {
    // Agent stats
    for (const id of [msg.from, msg.to]) {
      if (!agentStats[id]) agentStats[id] = { sent: 0, received: 0, lastSeen: null, failures: 0, volume24h: 0 };
    }
    agentStats[msg.from].sent++;
    agentStats[msg.to].received++;

    const ts = new Date(msg.timestamp).getTime();
    if (!agentStats[msg.from].lastSeen || ts > new Date(agentStats[msg.from].lastSeen).getTime()) {
      agentStats[msg.from].lastSeen = msg.timestamp;
    }

    if (now - ts < day) {
      agentStats[msg.from].volume24h++;
    }

    if (msg.status === 'failed' || msg.status === 'forbidden') {
      agentStats[msg.from].failures++;
    }

    // Edge aggregation for graph
    const edgeKey = `${msg.from}->${msg.to}`;
    if (!edgeMap[edgeKey]) edgeMap[edgeKey] = { from: msg.from, to: msg.to, count: 0, types: {} };
    edgeMap[edgeKey].count++;
    edgeMap[edgeKey].types[msg.type] = (edgeMap[edgeKey].types[msg.type] || 0) + 1;
  }

  const result = {
    generated: new Date().toISOString(),
    totalMessages: messages.length,
    messages: messages.map(({ toolCallId, sessionFile, ...rest }) => rest), // strip internal fields
    agents: agentStats,
    edges: Object.values(edgeMap),
    summary: {
      totalAgents: Object.keys(agentStats).length,
      escalations: messages.filter(m => m.type === 'escalation').length,
      last24h: messages.filter(m => now - new Date(m.timestamp).getTime() < day).length,
      failures: messages.filter(m => m.status === 'failed' || m.status === 'forbidden').length,
    },
  };

  fs.writeFileSync(OUTPUT, JSON.stringify(result, null, 2));
  console.log(`Extracted ${messages.length} messages from ${agentDirs.length} agents`);
  console.log(`Edges: ${result.edges.length}, Agents: ${result.summary.totalAgents}`);
  console.log(`Written to ${OUTPUT}`);
}

extractComms();
