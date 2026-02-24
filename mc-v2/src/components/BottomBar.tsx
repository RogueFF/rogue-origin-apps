import { useState, useRef, useEffect } from 'react';
import { useGatewayStore, type ChatMessage } from '../store/gateway';
import { useChatStore } from '../store/chat';

/** Minimal markdown: **bold**, newlines, `code` */
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

function DeliveryBadge({ msg }: { msg: ChatMessage }) {
  if (msg.role !== 'user') return null;
  const state = msg.state || 'complete';
  const labels: Record<string, { text: string; color: string }> = {
    pending:   { text: 'sending', color: 'var(--text-tertiary)' },
    streaming: { text: 'sent',    color: 'var(--accent-cyan)' },
    complete:  { text: '✓ delivered', color: 'var(--accent-green)' },
    error:     { text: '✗ failed',   color: 'var(--accent-red)' },
  };
  const { text, color } = labels[state] || labels.complete;
  return (
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color, marginLeft: 6 }}>
      {text}
    </span>
  );
}

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

  const agent = agents.find((a) => a.id === selectedAgent) || agents[0];
  const history = chatHistory[selectedAgent] || [];
  const isStreaming = chatStreaming[selectedAgent] || false;
  const isConnected = connectionState === 'connected';

  // Auto-scroll on new messages
  useEffect(() => {
    if (chatRef.current && expanded) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [history, expanded]);

  // Timeout stuck streaming after 60s
  useEffect(() => {
    if (!isStreaming) {
      setBusyWarning(false);
      return;
    }
    const busyTimer = setTimeout(() => setBusyWarning(true), 30_000);
    const killTimer = setTimeout(() => {
      useGatewayStore.getState().clearStreaming?.(selectedAgent);
    }, 60_000);
    return () => {
      clearTimeout(busyTimer);
      clearTimeout(killTimer);
    };
  }, [isStreaming, selectedAgent]);

  // Auto-expand when there's history
  useEffect(() => {
    if (history.length > 0 && !expanded) {
      // Don't auto-expand, let user control
    }
  }, [history.length, expanded]);

  const handleSend = async () => {
    if (!message.trim() || !isConnected) return;
    const msg = message.trim();
    setMessage('');
    setBusyWarning(false);
    if (!expanded) setExpanded(true);
    try {
      await sendChat(selectedAgent, msg);
    } catch (err) {
      console.error('Chat send failed:', err);
    }
    inputRef.current?.focus();
  };

  const historyCount = history.length;

  return (
    <div style={{
      borderTop: '1px solid var(--border-glass)',
      background: 'var(--bg-glass)',
      backdropFilter: 'blur(var(--card-blur))',
      WebkitBackdropFilter: 'blur(var(--card-blur))',
      position: 'relative',
      zIndex: 10,
    }}>

      {/* ── Expandable Chat Panel ── */}
      {expanded && (
        <div style={{
          borderBottom: '1px solid var(--border-subtle)',
          maxHeight: 280,
          display: 'flex',
          flexDirection: 'column',
        }}>
          {/* Panel header */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '6px 16px',
            borderBottom: '1px solid var(--border-subtle)',
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
                color: 'var(--text-tertiary)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}>
                Session: {agent?.name || selectedAgent}
              </span>
            </div>
            <button
              onClick={() => setExpanded(false)}
              style={{
                background: 'none',
                border: 'none',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--text-tertiary)',
                cursor: 'pointer',
                padding: '2px 6px',
              }}
            >
              ▾ collapse
            </button>
          </div>

          {/* Messages */}
          <div ref={chatRef} style={{ flex: 1, overflow: 'auto', padding: '8px 16px' }}>
            {history.length === 0 && (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-tertiary)', padding: '12px 0', textAlign: 'center' }}>
                No messages yet — send one below
              </div>
            )}
            {history.slice(-30).map((msg) => (
              <div
                key={msg.id}
                style={{
                  display: 'flex',
                  gap: 8,
                  padding: '4px 0',
                  fontFamily: 'var(--font-body)',
                  fontSize: 12,
                }}
              >
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: msg.role === 'user' ? 'var(--accent-cyan)' : agent?.color || 'var(--text-secondary)',
                  fontWeight: 600,
                  flexShrink: 0,
                  minWidth: 40,
                }}>
                  {msg.role === 'user' ? 'you' : agent?.name?.toLowerCase() || 'agent'}
                </span>
                <span style={{
                  color: msg.state === 'error' ? 'var(--accent-red)' : 'var(--text-primary)',
                  opacity: msg.state === 'streaming' ? 0.8 : 1,
                  wordBreak: 'break-word',
                  lineHeight: 1.5,
                  flex: 1,
                }}>
                  {renderMd(msg.content)}
                  {msg.state === 'streaming' && (
                    <span style={{ color: 'var(--text-tertiary)', marginLeft: 4 }}>▌</span>
                  )}
                </span>
                <DeliveryBadge msg={msg} />
              </div>
            ))}
            {isStreaming && history[history.length - 1]?.role !== 'assistant' && (
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--text-tertiary)',
                padding: '4px 0',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}>
                <span style={{ color: agent?.color }}>●</span>
                <span>{agent?.name} is thinking...</span>
                {busyWarning && (
                  <span style={{
                    color: 'var(--accent-gold)',
                    fontSize: 9,
                    marginLeft: 8,
                    fontStyle: 'italic',
                  }}>
                    Agent may be busy — you can still send messages
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Input Bar ── */}
      <div style={{
        height: 52,
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        gap: 10,
      }}>
        {/* Expand toggle */}
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            background: 'none',
            border: 'none',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            color: historyCount > 0 ? 'var(--accent-cyan)' : 'var(--text-tertiary)',
            cursor: 'pointer',
            padding: '4px 6px',
            flexShrink: 0,
            position: 'relative',
          }}
          title={expanded ? 'Collapse chat' : 'Expand chat'}
        >
          {expanded ? '▾' : '▴'}
          {historyCount > 0 && !expanded && (
            <span style={{
              position: 'absolute',
              top: 0,
              right: 0,
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--accent-cyan)',
            }} />
          )}
        </button>

        {/* Agent selector */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <select
            value={selectedAgent}
            onChange={(e) => setSelectedAgent(e.target.value)}
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
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <span style={{
            position: 'absolute',
            right: 8,
            top: '50%',
            transform: 'translateY(-50%)',
            fontSize: 8,
            color: 'var(--text-tertiary)',
            pointerEvents: 'none',
          }}>
            ▾
          </span>
        </div>

        {/* Input */}
        <input
          ref={inputRef}
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={
            !isConnected
              ? 'Connecting to Gateway...'
              : isStreaming
              ? `${agent?.name} is responding... (you can still type)`
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
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSend();
          }}
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
