/**
 * Gateway WebSocket Client — MC v2
 *
 * Thin TypeScript wrapper around the OpenClaw Gateway WS protocol.
 * Handles connect handshake, JSON-RPC request/response, event subscriptions,
 * auto-reconnect with exponential backoff, and tick keepalive.
 *
 * Protocol: JSON-RPC over WebSocket (protocol v3)
 * Frames: req {type,id,method,params} | res {type,id,ok,payload|error} | event {type,event,payload}
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GatewayConfig {
  /** ws:// or wss:// URL */
  url: string;
  /** Auth token (OPENCLAW_GATEWAY_TOKEN) */
  token?: string;
  /** Auto-reconnect (default true) */
  autoReconnect?: boolean;
  /** Max reconnect delay ms (default 30000) */
  maxReconnectDelay?: number;
}

export interface RequestFrame {
  type: 'req';
  id: string;
  method: string;
  params?: unknown;
}

export interface ResponseFrame {
  type: 'res';
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { code: string; message: string; details?: unknown };
}

export interface EventFrame {
  type: 'event';
  event: string;
  payload?: unknown;
  seq?: number;
  stateVersion?: { presence: number; health: number };
}

export type GatewayFrame = RequestFrame | ResponseFrame | EventFrame;

export type EventHandler = (payload: unknown, frame: EventFrame) => void;

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

// Chat event types
export interface ChatEvent {
  runId: string;
  sessionKey: string;
  seq: number;
  state: 'delta' | 'final' | 'aborted' | 'error';
  message?: unknown;
  errorMessage?: string;
  usage?: unknown;
  stopReason?: string;
}

// Presence entry
export interface PresenceEntry {
  host?: string;
  version?: string;
  platform?: string;
  mode?: string;
  deviceId?: string;
  roles?: string[];
  ts: number;
  text?: string;
  tags?: string[];
  lastInputSeconds?: number;
}

// Hello-ok snapshot
export interface HelloSnapshot {
  presence: PresenceEntry[];
  health: unknown;
  stateVersion: { presence: number; health: number };
  uptimeMs: number;
  sessionDefaults?: {
    defaultAgentId: string;
    mainKey: string;
    mainSessionKey: string;
  };
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class GatewayClient {
  private ws: WebSocket | null = null;
  private config: Required<GatewayConfig>;
  private state: ConnectionState = 'disconnected';
  private reqId = 0;
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private listeners = new Map<string, Set<EventHandler>>();
  private stateListeners = new Set<(state: ConnectionState) => void>();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private snapshot: HelloSnapshot | null = null;

  constructor(config: GatewayConfig) {
    this.config = {
      url: config.url,
      token: config.token ?? '',
      autoReconnect: config.autoReconnect ?? true,
      maxReconnectDelay: config.maxReconnectDelay ?? 30000,
    };
  }

  // ── Connection state ──────────────────────────────────────

  get connectionState(): ConnectionState { return this.state; }
  get initialSnapshot(): HelloSnapshot | null { return this.snapshot; }

  onStateChange(fn: (state: ConnectionState) => void): () => void {
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  }

  private setState(s: ConnectionState) {
    this.state = s;
    this.stateListeners.forEach(fn => fn(s));
  }

  // ── Connect ───────────────────────────────────────────────

  connect(): Promise<HelloSnapshot> {
    return new Promise((resolve, reject) => {
      if (this.ws) this.disconnect();
      this.setState('connecting');

      const ws = new WebSocket(this.config.url);
      this.ws = ws;

      ws.onopen = () => {
        // Wait for connect.challenge event, then send connect request
      };

      ws.onmessage = (ev) => {
        let frame: GatewayFrame;
        try {
          frame = JSON.parse(ev.data as string);
        } catch {
          return;
        }

        // Handle connect.challenge → send connect request
        if (frame.type === 'event' && frame.event === 'connect.challenge') {
          const connectReq: RequestFrame = {
            type: 'req',
            id: this.nextId(),
            method: 'connect',
            params: {
              minProtocol: 3,
              maxProtocol: 3,
              client: {
                id: 'openclaw-control-ui' as const,
                version: '0.1.0',
                platform: 'web',
                mode: 'ui' as const,
              },
              role: 'operator',
              scopes: ['operator.read', 'operator.write'],
              caps: [],
              commands: [],
              permissions: {},
              ...(this.config.token ? { auth: { token: this.config.token } } : {}),
            },
          };
          ws.send(JSON.stringify(connectReq));
          return;
        }

        // Handle hello-ok response
        if (frame.type === 'res' && frame.ok && (frame.payload as Record<string, unknown>)?.type === 'hello-ok') {
          const helloOk = frame.payload as Record<string, unknown>;
          this.snapshot = helloOk.snapshot as HelloSnapshot;
          this.setState('connected');
          this.reconnectAttempt = 0;

          // Start tick keepalive
          const tickInterval = ((helloOk.policy as Record<string, unknown>)?.tickIntervalMs as number) || 15000;
          this.startTick(tickInterval);

          // Emit connected event
          this.emit('_connected', this.snapshot);
          resolve(this.snapshot);
          return;
        }

        // Handle hello error
        if (frame.type === 'res' && !frame.ok) {
          const pending = this.pending.get(frame.id);
          if (pending) {
            pending.reject(new Error(frame.error?.message || 'Request failed'));
            clearTimeout(pending.timer);
            this.pending.delete(frame.id);
          }
          // If this was the connect response, reject the connect promise
          if (this.state === 'connecting') {
            reject(new Error(frame.error?.message || 'Connect failed'));
            this.disconnect();
          }
          return;
        }

        this.handleFrame(frame);
      };

      ws.onerror = () => {
        if (this.state === 'connecting') {
          reject(new Error('WebSocket connection failed'));
        }
      };

      ws.onclose = () => {
        this.cleanup();
        this.setState('disconnected');
        if (this.config.autoReconnect && this.state !== 'connecting') {
          this.scheduleReconnect();
        }
      };
    });
  }

  disconnect() {
    this.config.autoReconnect = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.cleanup();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setState('disconnected');
  }

  private cleanup() {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
    // Reject all pending requests
    this.pending.forEach(({ reject, timer }) => {
      clearTimeout(timer);
      reject(new Error('Connection closed'));
    });
    this.pending.clear();
  }

  private scheduleReconnect() {
    const delay = Math.min(1000 * 2 ** this.reconnectAttempt, this.config.maxReconnectDelay);
    this.reconnectAttempt++;
    this.setState('reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(() => {
        // Will retry via onclose
      });
    }, delay);
  }

  private startTick(intervalMs: number) {
    this.tickTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'req', id: this.nextId(), method: 'tick', params: {} }));
      }
    }, intervalMs);
  }

  // ── Request/Response ──────────────────────────────────────

  private nextId(): string {
    return `mc-${++this.reqId}`;
  }

  request<T = unknown>(method: string, params?: unknown, timeoutMs = 30000): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return reject(new Error('Not connected'));
      }
      const id = this.nextId();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, timeoutMs);

      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.ws.send(JSON.stringify({ type: 'req', id, method, params }));
    });
  }

  private handleFrame(frame: GatewayFrame) {
    if (frame.type === 'res') {
      const p = this.pending.get(frame.id);
      if (p) {
        clearTimeout(p.timer);
        this.pending.delete(frame.id);
        if (frame.ok) {
          p.resolve(frame.payload);
        } else {
          p.reject(new Error(frame.error?.message || 'Request failed'));
        }
      }
    } else if (frame.type === 'event') {
      this.emit(frame.event, frame.payload, frame);
    }
  }

  // ── Events ────────────────────────────────────────────────

  on(event: string, handler: EventHandler): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler);
    return () => this.listeners.get(event)?.delete(handler);
  }

  off(event: string, handler: EventHandler) {
    this.listeners.get(event)?.delete(handler);
  }

  private emit(event: string, payload?: unknown, frame?: EventFrame) {
    const eventFrame = frame || { type: 'event' as const, event, payload };
    this.listeners.get(event)?.forEach(fn => fn(payload, eventFrame));
    // Wildcard listeners
    this.listeners.get('*')?.forEach(fn => fn(payload, eventFrame));
  }

  // ── Convenience Methods ───────────────────────────────────

  /** Send a chat message to a session, returns runId */
  chatSend(sessionKey: string, message: string): Promise<{ runId: string }> {
    return this.request('chat.send', {
      sessionKey,
      message,
      idempotencyKey: `mc-chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });
  }

  /** Get chat history for a session */
  chatHistory(sessionKey: string, limit = 50): Promise<unknown> {
    return this.request('chat.history', { sessionKey, limit });
  }

  /** List sessions */
  sessionsList(params?: { limit?: number; activeMinutes?: number; includeLastMessage?: boolean }): Promise<unknown> {
    return this.request('sessions.list', params);
  }

  /** Get system presence */
  systemPresence(): Promise<unknown> {
    return this.request('system-presence');
  }

  /** Get system health */
  systemHealth(): Promise<unknown> {
    return this.request('system-health');
  }

  /** List cron jobs */
  cronList(): Promise<unknown> {
    return this.request('cron.list');
  }

  /** Tail logs */
  logsTail(cursor?: number, limit = 100): Promise<{ file: string; cursor: number; lines: string[]; truncated?: boolean }> {
    return this.request('logs.tail', { cursor, limit });
  }

  /** Get agent identity */
  agentIdentity(agentId: string): Promise<{ agentId: string; name?: string; emoji?: string }> {
    return this.request('agent.identity', { agentId });
  }
}

// ---------------------------------------------------------------------------
// Singleton factory
// ---------------------------------------------------------------------------

let instance: GatewayClient | null = null;

export function getGatewayClient(): GatewayClient {
  if (!instance) {
    // Determine WS URL:
    // HTTPS (Tailscale Funnel) → proxy through Vite /gw-ws → gateway
    // HTTP (localhost dev) → direct to gateway on 18789
    const wsUrl = import.meta.env.VITE_GATEWAY_WS_URL
      || (location.protocol === 'https:'
        ? `wss://${location.host}/gw-ws`
        : `ws://localhost:18789`);
    const token = import.meta.env.VITE_GATEWAY_TOKEN as string || '';

    instance = new GatewayClient({ url: wsUrl, token });
  }
  return instance;
}
