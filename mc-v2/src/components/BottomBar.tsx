import { useState, useRef, useEffect, useCallback } from 'react';
import { useGatewayStore, type ChatMessage } from '../store/gateway';
import { useChatStore } from '../store/chat';
import { getGatewayClient } from '../lib/gateway-client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'mc-v2-selected-agent';

function renderMd(text: string) {
  const lines = text.split('\n');
  return lines.map((line, li) => {
    const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    const spans = parts.map((part, pi) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={pi} style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return <code key={pi} style={{ background: 'rgba(255,255,255,0.06)', padding: '1px 4px', borderRadius: 3, fontSize: '0.9em' }}>{part.slice(1, -1)}</code>;
      }
      return <span key={pi}>{part}</span>;
    });
    return (
      <span key={li}>
        {li > 0 && <br />}
        {spans}
      </span>
    );
  });
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
}

// ---------------------------------------------------------------------------
// BottomBar
// ---------------------------------------------------------------------------

export function BottomBar() {
  const { selectedAgent, message, setSelectedAgent, setMessage } = useChatStore();
  const agents = useGatewayStore((s) => s.agents);
  const sendChat = useGatewayStore((s) => s.sendChat);
  const chatHistory = useGatewayStore((s) => s.chatHistory);
  const chatStreaming = useGatewayStore((s) => s.chatStreaming);
  const connectionState = useGatewayStore((s) => s.connectionState);
  const inputRef = useRef<HTMLInputElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  const [expanded, setExpanded] = useState(false);
  const [busyWarning, setBusyWarning] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState<Record<string, boolean>>({});
  const [userScrolled, setUserScrolled] = useState(false);

  const agent = agents.find((a) => a.id === selectedAgent) || agents[0];
  const history = chatHistory[selectedAgent] || [];
  const isStreaming = chatStreaming[selectedAgent] || false;
  const isConnected = connectionState === 'connected';

  // Persist agent selection
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && agents.some(a => a.id === saved)) {
      setSelectedAgent(saved);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, selectedAgent);
  }, [selectedAgent]);

  // Load history when agent changes or panel expands
  useEffect(() => {
    if (!expanded || !isConnected || historyLoaded[selectedAgent]) return;
    const loadHistory = async () => {
      try {
        const client = getGatewayClient();
        const sessionKey = `agent:${selectedAgent}:main`;
        const resp = await client.chatHistory(sessionKey, 20) as { messages?: Array<{ role: string; content: unknown; timestamp?: number }> };
        if (resp?.messages?.length) {
          // Merge into existing history (gateway store handles this via chat events,
          // but we can seed from history if empty)
          const existing = useGatewayStore.getState().chatHistory[selectedAgent] || [];
          if (existing.length === 0) {
            const seeded: ChatMessage[] = resp.messages.map((m, i) => {
              const text = typeof m.content === 'string' ? m.content :
                Array.isArray(m.content) ? m.content.map((b: unknown) => typeof b === 'string' ? b : (b as { text?: string })?.text || '').join('') :
                String(m.content || '');
              return {
                id: `hist-${i}-${m.timestamp || Date.now()}`,
                role: m.role as 'user' | 'assistant',
                content: text,
                timestamp: m.timestamp || Date.now(),
                state: 'complete' as const,
              };
            });
            useGatewayStore.setState(s => ({
              chatHistory: { ...s.chatHistory, [selectedAgent]: seeded },
            }));
          }
        }
      } catch (err) {
        console.warn('[chat] History load failed:', err);
      }
      setHistoryLoaded(prev => ({ ...prev, [selectedAgent]: true }));
    };
    loadHistory();
  }, [expanded, isConnected, selectedAgent, historyLoaded]);

  // Auto-scroll on new messages (unless user scrolled up)
  useEffect(() => {
    if (chatRef.current && !userScrolled) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [history, userScrolled]);

  // Detect user scroll
  const handleScroll = useCallback(() => {
    if (!chatRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = chatRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 40;
    setUserScrolled(!atBottom);
  }, []);

  // Streaming timeout
  useEffect(() => {
    if (!isStreaming) {
      setBusyWarning(false);
      return;
    }
    const busyTimer = setTimeout(() => setBusyWarning(true), 30_000);
    const killTimer = setTimeout(() => {
      useGatewayStore.getState().clearStreaming?.(selectedAgent);
    }, 60_000);
    return () => { clearTimeout(busyTimer); clearTimeout(killTimer); };
  }, [isStreaming, selectedAgent]);

  const handleSend = async () => {
    if (!message.trim() || !isConnected) return;
    const msg = message.trim();
    setMessage('');
    setSendError(null);
    setBusyWarning(false);
    if (!expanded) setExpanded(true);
    try {
      await sendChat(selectedAgent, msg);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Send failed';
      setSendError(errMsg);
    }
    inputRef.current?.focus();
  };

  const handleRetry = () => {
    setSendError(null);
    // Re-send last user message
    const lastUser = [...history].reverse().find(m => m.role === 'user');
    if (lastUser) {
      setMessage(lastUser.content);
    }
  };

  // Last message preview for collapsed state
  const lastMsg = history[history.length - 1];
  const previewText = lastMsg
    ? `${lastMsg.role === 'user' ? 'You' : agent?.name}: ${lastMsg.content.slice(0, 60)}${lastMsg.content.length > 60 ? '...' : ''}`
    : '';
  const hasUnread = lastMsg?.role === 'assistant' && lastMsg.state === 'complete' && !expanded;

  return (
    <div style={{
      borderTop: '1px solid var(--border-glass)',
      background: 'var(--bg-glass)',
      backdropFilter: 'blur(var(--card-blur))',
      WebkitBackdropFilter: 'blur(var(--card-blur))',
      position: 'relative',
      zIndex: 10,
    }}>
      {/* Connection lost banner */}
      {!isConnected && (
        <div style={{
          background: 'rgba(255,51,68,0.1)',
          borderBottom: '1px solid rgba(255,51,68,0.2)',
          padding: '4px 16px',
          fontFamily: 'var(--font-mono)',
          fontSize: 9,
          color: 'var(--accent-red)',
          textAlign: 'center',
        }}>
          ⚠ Connection lost — reconnecting...
        </div>
      )}

      {/* ── Expanded Chat Panel ── */}
      {expanded && (
        <div style={{
          height: 300,
          display: 'flex',
          flexDirection: 'column',
          borderBottom: '1px solid var(--border-subtle)',
        }}>
          {/* Panel header */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '6px 16px',
            borderBottom: '1px solid var(--border-subtle)',
            flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{
                width: 6, height: 6, borderRadius: '50%',
                background: isConnected ? 'var(--accent-green)' : 'var(--accent-red)',
                boxShadow: isConnected ? '0 0 6px var(--accent-green)' : 'none',
              }} />
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                color: agent?.color || 'var(--text-tertiary)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}>
                {agent?.name || selectedAgent}
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-tertiary)' }}>
                agent:{selectedAgent}:main
              </span>
            </div>
            <button
              onClick={() => setExpanded(false)}
              style={{
                background: 'none', border: 'none',
                fontFamily: 'var(--font-mono)', fontSize: 10,
                color: 'var(--text-tertiary)', cursor: 'pointer', padding: '2px 6px',
              }}
            >
              ▾ collapse
            </button>
          </div>

          {/* Messages */}
          <div
            ref={chatRef}
            onScroll={handleScroll}
            style={{ flex: 1, overflow: 'auto', padding: '8px 16px' }}
          >
            {history.length === 0 && (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-tertiary)', padding: '24px 0', textAlign: 'center' }}>
                No messages yet — send one below
              </div>
            )}
            {history.map((msg) => {
              const isUser = msg.role === 'user';
              return (
                <div
                  key={msg.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: isUser ? 'flex-end' : 'flex-start',
                    marginBottom: 8,
                  }}
                >
                  {/* Message bubble */}
                  <div style={{
                    maxWidth: '80%',
                    background: isUser ? 'rgba(0,240,255,0.08)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${isUser ? 'rgba(0,240,255,0.15)' : 'var(--border-subtle)'}`,
                    borderRadius: isUser ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                    padding: '8px 12px',
                  }}>
                    <div style={{
                      fontFamily: 'var(--font-body)',
                      fontSize: 12,
                      color: msg.state === 'error' ? 'var(--accent-red)' : 'var(--text-primary)',
                      opacity: msg.state === 'streaming' ? 0.8 : 1,
                      lineHeight: 1.5,
                      wordBreak: 'break-word',
                    }}>
                      {renderMd(msg.content)}
                      {msg.state === 'streaming' && (
                        <span style={{ color: 'var(--text-tertiary)', marginLeft: 4 }}>▌</span>
                      )}
                    </div>
                  </div>

                  {/* Timestamp + delivery state */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    marginTop: 2,
                    padding: '0 4px',
                  }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-tertiary)' }}>
                      {formatTime(msg.timestamp)}
                    </span>
                    {isUser && (
                      <span style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 7,
                        color: msg.state === 'error' ? 'var(--accent-red)'
                          : msg.state === 'pending' ? 'var(--text-tertiary)'
                          : msg.state === 'streaming' ? 'var(--accent-cyan)'
                          : 'var(--accent-green)',
                      }}>
                        {msg.state === 'pending' ? 'sending...'
                          : msg.state === 'error' ? '✗ failed'
                          : msg.state === 'streaming' ? 'sent'
                          : '✓ delivered'}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Streaming indicator */}
            {isStreaming && history[history.length - 1]?.role !== 'assistant' && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 0',
              }}>
                <div className="dot-pulse" style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: agent?.color || 'var(--accent-cyan)',
                }} />
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-tertiary)' }}>
                  {agent?.name} is thinking...
                </span>
                {busyWarning && (
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--accent-gold)', fontStyle: 'italic' }}>
                    Agent may be busy
                  </span>
                )}
              </div>
            )}

            {/* Send error */}
            {sendError && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 10px',
                background: 'rgba(255,51,68,0.08)',
                border: '1px solid rgba(255,51,68,0.15)',
                borderRadius: 8,
                marginTop: 4,
              }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--accent-red)' }}>
                  ⚠ {sendError}
                </span>
                <button
                  onClick={handleRetry}
                  style={{
                    background: 'none',
                    border: '1px solid var(--accent-red)',
                    borderRadius: 4,
                    padding: '2px 8px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 9,
                    color: 'var(--accent-red)',
                    cursor: 'pointer',
                  }}
                >
                  Retry
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Collapsed preview / Input bar ── */}
      {!expanded && previewText && (
        <div
          onClick={() => setExpanded(true)}
          style={{
            padding: '6px 16px',
            borderBottom: '1px solid var(--border-subtle)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          {hasUnread && (
            <div style={{
              width: 6, height: 6, borderRadius: '50%',
              background: 'var(--accent-cyan)',
              flexShrink: 0,
            }} />
          )}
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--text-secondary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}>
            {previewText}
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-tertiary)' }}>
            ▴ expand
          </span>
        </div>
      )}

      {/* Input bar */}
      <div style={{
        height: 52,
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        gap: 10,
      }}>
        {/* Agent selector */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <select
            value={selectedAgent}
            onChange={(e) => {
              setSelectedAgent(e.target.value);
              setUserScrolled(false);
            }}
            style={{
              appearance: 'none',
              background: 'var(--input-bg)',
              border: '1px solid var(--input-border)',
              borderRadius: 'var(--card-radius)',
              padding: '6px 28px 6px 10px',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: agent?.color || 'var(--text-primary)',
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <span style={{
            position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
            fontSize: 8, color: 'var(--text-tertiary)', pointerEvents: 'none',
          }}>▾</span>
        </div>

        {/* Input */}
        <input
          ref={inputRef}
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={
            !isConnected ? 'Connecting...'
              : isStreaming ? `${agent?.name} responding... (you can still type)`
              : `Message ${agent?.name}...`
          }
          disabled={!isConnected}
          style={{
            flex: 1,
            background: 'var(--input-bg)',
            border: '1px solid var(--input-border)',
            borderRadius: 'var(--card-radius)',
            padding: '8px 14px',
            fontFamily: 'var(--font-body)',
            fontSize: 12,
            color: 'var(--text-primary)',
            outline: 'none',
            opacity: isConnected ? 1 : 0.5,
          }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
          onFocus={() => { if (history.length > 0 && !expanded) setExpanded(true); }}
        />

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={!isConnected || !message.trim()}
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-card)',
            borderRadius: 'var(--card-radius)',
            padding: '6px 16px',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: isConnected && message.trim() ? 'var(--text-secondary)' : 'var(--text-tertiary)',
            cursor: isConnected && message.trim() ? 'pointer' : 'not-allowed',
            opacity: isConnected && message.trim() ? 1 : 0.5,
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
