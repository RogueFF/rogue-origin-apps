/**
 * Gateway Store — bridges WS events to React via Zustand
 *
 * Manages: connection state, agent presence, health, sessions,
 * chat streams, cron jobs, and real-time notifications.
 */

import { create } from 'zustand';
import { useToastStore } from '../lib/notifications-api';
import {
  getGatewayClient,
  type ConnectionState,
  type ChatEvent,
  type PresenceEntry,
  type GatewayClient,
} from '../lib/gateway-client';
import { toastSuccess, toastWarning, toastInfo } from '../lib/notifications-api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentState {
  id: string;
  name: string;
  color: string;
  status: 'online' | 'running' | 'idle' | 'offline';
  task: string;
  lastActivity: string;
  emoji?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  state?: 'pending' | 'streaming' | 'complete' | 'error';
  runId?: string;
}

export interface Notification {
  id: string;
  type: 'briefing' | 'production' | 'alert' | 'toast' | 'chat';
  title: string;
  body: string;
  timestamp: string;
  timestampMs?: number;
  accentColor: string;
  sessionKey?: string;
  agentId?: string;
}

export interface CronJob {
  id: string;
  name?: string;
  schedule: unknown;
  payload: unknown;
  enabled: boolean;
  nextRun?: string;
}

interface GatewayStore {
  // Connection
  connectionState: ConnectionState;
  uptimeMs: number;
  serverVersion: string;

  // Agents (derived from config + presence)
  agents: AgentState[];

  // Chat per agent
  chatHistory: Record<string, ChatMessage[]>;
  chatStreaming: Record<string, boolean>;

  // Notifications (real-time)
  notifications: Notification[];

  // Crons
  crons: CronJob[];

  // Sessions
  sessions: unknown[];

  // Actions
  connect: () => Promise<void>;
  disconnect: () => void;
  sendChat: (agentId: string, message: string) => Promise<void>;
  clearStreaming: (agentId: string) => void;
  refreshSessions: () => Promise<void>;
  refreshCrons: () => Promise<void>;
}

// Agent config from shared constants
import { AGENT_CONFIG, FEED_CACHE_KEY, FEED_MAX_ITEMS } from '../lib/constants';
import { timeAgo } from '../lib/utils';
import { loadChatHistory, persistChatHistory } from './chat';

// Session key patterns for each agent
function agentMainSessionKey(agentId: string): string {
  return `agent:${agentId}:main`;
}

function deriveAgentStatus(entry?: PresenceEntry): 'online' | 'running' | 'idle' | 'offline' {
  if (!entry) return 'offline';
  const idleSec = entry.lastInputSeconds ?? Infinity;
  if (idleSec < 60) return 'running';
  if (idleSec < 300) return 'online';
  return 'idle';
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useGatewayStore = create<GatewayStore>((set, get) => {
  let client: GatewayClient | null = null;
  let cleanups: (() => void)[] = [];
  let lastSeedConnectId = 0;  // Reseed on each new connection
  let connectId = 0;

  function buildAgents(presence: PresenceEntry[]): AgentState[] {
    return Object.entries(AGENT_CONFIG).map(([id, cfg]) => {
      // Match presence entry — prefer agentId field, then tags, then heuristics
      const entry = presence.find(p =>
        (p as Record<string, unknown>).agentId === id ||
        p.tags?.includes(`agent:${id}`) ||
        p.tags?.includes(id) ||
        p.roles?.includes(id) ||
        p.text?.toLowerCase().includes(id) ||
        p.mode?.toLowerCase().includes(id)
      );
      // For 'main' (Atlas), use the gateway presence itself as fallback
      const fallback = id === 'main' && !entry ? presence[0] : undefined;
      const match = entry || fallback;
      return {
        id,
        name: cfg.name,
        color: cfg.color,
        status: match ? deriveAgentStatus(match) : 'idle',
        task: id === 'main' ? 'Orchestrator' : (match?.text || 'Idle'),
        lastActivity: match ? timeAgo(match.ts) : '—',
      };
    });
  }

  function wireEvents(client: GatewayClient) {
    // Connection state — fire toasts on transitions
    let prevState: ConnectionState = 'disconnected';
    cleanups.push(client.onStateChange((state) => {
      set({ connectionState: state });
      // Reconnect feedback
      if (state === 'reconnecting' && prevState === 'connected') {
        toastWarning('Connection lost', 'Reconnecting...');
      } else if (state === 'connected' && (prevState === 'reconnecting' || prevState === 'connecting')) {
        if (prevState === 'reconnecting') {
          toastSuccess('Connected', 'Gateway connection restored');
        }
      } else if (state === 'disconnected' && prevState === 'connected') {
        toastWarning('Disconnected', 'Gateway connection lost');
      }
      prevState = state;
    }));

    // Presence updates — detect agent status changes
    cleanups.push(client.on('presence', (payload) => {
      const entries = (payload as { entries?: PresenceEntry[] })?.entries || [];
      const oldAgents = get().agents;
      const newAgents = buildAgents(entries);
      // Detect status transitions worth notifying
      for (const newA of newAgents) {
        const oldA = oldAgents.find(a => a.id === newA.id);
        if (oldA && oldA.status !== newA.status) {
          if (newA.status === 'running' && oldA.status !== 'running') {
            toastInfo(`${newA.name} active`, 'Agent started working');
          } else if (newA.status === 'offline' && oldA.status !== 'offline') {
            toastInfo(`${newA.name} offline`, 'Agent went offline');
          }
        }
      }
      set({ agents: newAgents });
    }));

    // Health updates
    cleanups.push(client.on('health', (payload) => {
      // Could update a health store section
      void payload;
    }));

    // Chat events (streaming responses)
    cleanups.push(client.on('chat', (payload) => {
      const ev = payload as ChatEvent;
      const { chatHistory, chatStreaming } = get();

      // Normalize content: handles string, {type,text}[], or {content: ...}
      const extractText = (msg: unknown): string => {
        if (typeof msg === 'string') return msg;
        if (Array.isArray(msg)) return msg.map(b => (typeof b === 'string' ? b : b?.text || '')).join('');
        if (msg && typeof msg === 'object') {
          const c = (msg as Record<string, unknown>).content;
          if (c !== undefined) return extractText(c);
          const t = (msg as Record<string, unknown>).text;
          if (typeof t === 'string') return t;
        }
        return '';
      };

      // Find which agent this session belongs to
      const agentId = Object.keys(AGENT_CONFIG).find(id =>
        ev.sessionKey.includes(id)
      ) || 'main';

      const history = [...(chatHistory[agentId] || [])];

      if (ev.state === 'delta') {
        // Find or create streaming message
        const existing = history.find(m => m.runId === ev.runId && m.role === 'assistant');
        if (existing) {
          // Append delta content
          existing.content += extractText(ev.message);
          existing.state = 'streaming';
        } else {
          history.push({
            id: `${ev.runId}-${ev.seq}`,
            role: 'assistant',
            content: extractText(ev.message),
            timestamp: Date.now(),
            state: 'streaming',
            runId: ev.runId,
          });
        }
        set({
          chatHistory: { ...chatHistory, [agentId]: history },
          chatStreaming: { ...chatStreaming, [agentId]: true },
        });
      } else if (ev.state === 'final') {
        const existing = history.find(m => m.runId === ev.runId && m.role === 'assistant');
        if (existing) {
          existing.state = 'complete';
          // If final includes full message, replace
          if (ev.message) {
            existing.content = extractText(ev.message) || existing.content;
          }
        }
        set({
          chatHistory: { ...chatHistory, [agentId]: history },
          chatStreaming: { ...chatStreaming, [agentId]: false },
        });
      } else if (ev.state === 'error' || ev.state === 'aborted') {
        const existing = history.find(m => m.runId === ev.runId && m.role === 'assistant');
        if (existing) {
          existing.state = 'error';
          existing.content += ev.errorMessage ? `\n\n⚠️ ${ev.errorMessage}` : '';
        }
        set({
          chatHistory: { ...chatHistory, [agentId]: history },
          chatStreaming: { ...chatStreaming, [agentId]: false },
        });
        // Toast on agent errors
        const agentName = AGENT_CONFIG[agentId]?.name || agentId;
        toastWarning(`${agentName} Error`, ev.errorMessage || 'Agent response failed');
      }

      // Add meaningful responses to notification feed (skip noise)
      if (ev.state === 'final' && ev.message) {
        const msgContent = extractText(ev.message);
        const isNoise = !msgContent ||
          msgContent.length < 10 ||
          /^(HEARTBEAT_OK|NO_REPLY|ok|done)$/i.test(msgContent.trim()) ||
          ev.sessionKey.includes(':cron:') ||
          ev.sessionKey.includes(':hook:');
        if (!isNoise) {
          addNotification({
            type: 'chat',
            title: `${AGENT_CONFIG[agentId]?.name || agentId}`,
            body: msgContent.slice(0, 200),
            accentColor: AGENT_CONFIG[agentId]?.color || 'var(--accent-cyan)',
            sessionKey: ev.sessionKey,
            agentId,
          });
        }
      }
    }));

    // Agent events
    cleanups.push(client.on('agent', (payload) => {
      const ev = payload as Record<string, unknown>;
      const stream = ev.stream as string;
      if (stream === 'tool-start' || stream === 'tool-end') {
        // Could add to notifications
      }
    }));

    // Cron events
    cleanups.push(client.on('cron.fired', (payload) => {
      const ev = payload as Record<string, unknown>;
      addNotification({
        type: 'toast',
        title: `Cron: ${(ev.name as string) || 'Job fired'}`,
        body: (ev.text as string) || 'Scheduled job executed',
        accentColor: 'var(--accent-gold)',
      });
    }));
  }

  // Load cached feed from localStorage
  function loadCachedFeed(): Notification[] {
    try {
      const raw = localStorage.getItem(FEED_CACHE_KEY);
      return raw ? (JSON.parse(raw) as Notification[]).slice(0, FEED_MAX_ITEMS) : [];
    } catch { return []; }
  }

  function persistFeed(items: Notification[]) {
    try {
      localStorage.setItem(FEED_CACHE_KEY, JSON.stringify(items.slice(0, FEED_MAX_ITEMS)));
    } catch { /* quota exceeded */ }
  }

  function addNotification(n: Omit<Notification, 'id' | 'timestamp'>) {
    const { notifications } = get();
    const notification: Notification = {
      ...n,
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }),
      timestampMs: Date.now(),
    };
    const updated = [notification, ...notifications].slice(0, FEED_MAX_ITEMS);
    set({ notifications: updated });
    persistFeed(updated);
  }

  return {
    connectionState: 'disconnected',
    uptimeMs: 0,
    serverVersion: '',
    agents: Object.entries(AGENT_CONFIG).map(([id, cfg]) => ({
      id, name: cfg.name, color: cfg.color, status: 'offline' as const,
      task: 'Connecting...', lastActivity: 'unknown',
    })),
    chatHistory: Object.fromEntries(
      Object.keys(AGENT_CONFIG).map(id => [id, loadChatHistory(id) as ChatMessage[]])
    ),
    chatStreaming: {},
    notifications: loadCachedFeed(),
    crons: [],
    sessions: [],

    connect: async () => {
      client = getGatewayClient();
      wireEvents(client);

      try {
        connectId++;
        const snapshot = await client.connect();
        set({
          uptimeMs: snapshot.uptimeMs,
          agents: buildAgents(snapshot.presence),
        });

        // Load initial data + start polling
        get().refreshSessions();
        get().refreshCrons();

        // Poll sessions every 30s to keep agent status fresh
        const sessionPoll = setInterval(() => {
          get().refreshSessions();
        }, 30_000);
        cleanups.push(() => clearInterval(sessionPoll));
      } catch (err) {
        console.error('[gateway] Connect failed:', err);
        // Will auto-reconnect
      }
    },

    disconnect: () => {
      cleanups.forEach(fn => fn());
      cleanups = [];
      client?.disconnect();
      client = null;
    },

    clearStreaming: (agentId: string) => {
      const { chatStreaming, chatHistory } = get();
      const history = [...(chatHistory[agentId] || [])];
      // Add timeout message if still streaming
      if (chatStreaming[agentId]) {
        history.push({
          id: `timeout-${Date.now()}`,
          role: 'assistant',
          content: '⏱ Response timed out. Agent may be busy or message was not delivered.',
          timestamp: Date.now(),
          state: 'error',
        });
      }
      set({
        chatStreaming: { ...chatStreaming, [agentId]: false },
        chatHistory: { ...chatHistory, [agentId]: history },
      });
    },

    sendChat: async (agentId: string, message: string) => {
      if (!client) throw new Error('Not connected');
      const sessionKey = agentMainSessionKey(agentId);
      const { chatHistory } = get();
      const history = [...(chatHistory[agentId] || [])];

      // Add user message
      history.push({
        id: `user-${Date.now()}`,
        role: 'user',
        content: message,
        timestamp: Date.now(),
        state: 'complete',
      });
      set({
        chatHistory: { ...chatHistory, [agentId]: history },
        chatStreaming: { ...get().chatStreaming, [agentId]: true },
      });

      try {
        await client.chatSend(sessionKey, message);
        // Response will come via chat events
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Send failed';
        const h = [...(get().chatHistory[agentId] || [])];
        h.push({
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: `⚠️ ${errMsg}`,
          timestamp: Date.now(),
          state: 'error',
        });
        set({
          chatHistory: { ...get().chatHistory, [agentId]: h },
          chatStreaming: { ...get().chatStreaming, [agentId]: false },
        });
      }
    },

    refreshSessions: async () => {
      if (!client) return;
      try {
        const result = await client.sessionsList({ limit: 50, activeMinutes: 120 });
        const sessions = ((result as Record<string, unknown>)?.sessions as Record<string, unknown>[]) || [];
        set({ sessions: sessions as unknown[] });

        // Update agent statuses from session data
        const { agents } = get();
        const updated = agents.map(agent => {
          // Find this agent's main session
          const mainKey = `agent:${agent.id}:main`;
          const session = sessions.find(s => (s.key as string) === mainKey);
          if (!session) return agent;

          const updatedAt = session.updatedAt as number;
          const ageSec = Math.floor((Date.now() - updatedAt) / 1000);
          const model = session.model as string || '';

          // Determine status from session activity
          let status: 'online' | 'running' | 'idle' | 'offline' = 'idle';
          if (ageSec < 30) status = 'running';
          else if (ageSec < 300) status = 'online';
          else if (ageSec < 3600) status = 'idle';
          else status = 'offline';

          const task = agent.id === 'main' ? 'Orchestrator' : (
            status === 'running' ? `Active (${model.split('/').pop() || 'thinking'})` :
            status === 'online' ? 'Ready' : 'Idle'
          );

          return {
            ...agent,
            status,
            task,
            lastActivity: updatedAt ? timeAgo(updatedAt) : agent.lastActivity,
          };
        });
        set({ agents: updated });

        // Seed activity feed on connect/reconnect — show recent session activity
        if (lastSeedConnectId !== connectId) {
          lastSeedConnectId = connectId;
          const now = Date.now();
          const thirtyMin = 30 * 60 * 1000;
          const recentSessions = sessions
            .filter(s => {
              const updatedAt = s.updatedAt as number;
              const key = s.key as string;
              // Only main agent sessions, active in last 30min
              return updatedAt && (now - updatedAt) < thirtyMin &&
                key.match(/^agent:[a-z]+:main$/);
            })
            .sort((a, b) => (b.updatedAt as number) - (a.updatedAt as number))
            .slice(0, 8);

          const seedNotifs: Notification[] = recentSessions.map(s => {
            const key = s.key as string;
            const agentId = key.split(':')[1] || 'main';
            const cfg = AGENT_CONFIG[agentId];
            const updatedAt = s.updatedAt as number;
            const ageSec = Math.floor((now - updatedAt) / 1000);
            const agoStr = ageSec < 60 ? 'just now' : ageSec < 3600 ? `${Math.floor(ageSec / 60)}m ago` : `${Math.floor(ageSec / 3600)}h ago`;
            const label = s.displayName as string || s.label as string || '';
            const isHeartbeat = label.toLowerCase().includes('heartbeat');

            let body = `${cfg?.name || agentId} responded ${agoStr}`;
            if (isHeartbeat) body = `${cfg?.name || agentId} completed heartbeat ${agoStr}`;

            return {
              id: `seed-${agentId}-${updatedAt}`,
              type: 'chat' as const,
              title: cfg?.name || agentId,
              body,
              timestamp: new Date(updatedAt).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }),
              accentColor: cfg?.color || 'var(--text-secondary)',
              sessionKey: key,
              agentId,
            };
          });

          if (seedNotifs.length > 0) {
            const { notifications: existing } = get();
            const merged = [...seedNotifs, ...existing].slice(0, FEED_MAX_ITEMS);
            set({ notifications: merged });
            persistFeed(merged);
          }
        }
      } catch (err) {
        console.error('[gateway] sessions.list failed:', err);
      }
    },

    refreshCrons: async () => {
      if (!client) return;
      try {
        const result = await client.cronList();
        const jobs = (result as Record<string, unknown>)?.jobs as CronJob[] || [];
        set({ crons: jobs });
      } catch (err) {
        console.error('[gateway] cron.list failed:', err);
      }
    },
  };
});

// Auto-persist chat history to localStorage on changes
let prevChatRef: Record<string, ChatMessage[]> = {};
useGatewayStore.subscribe((state) => {
  const { chatHistory } = state;
  for (const agentId of Object.keys(chatHistory)) {
    if (chatHistory[agentId] !== prevChatRef[agentId]) {
      persistChatHistory(agentId, chatHistory[agentId]);
    }
  }
  prevChatRef = chatHistory;
});
