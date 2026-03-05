import { useState, useRef, useEffect } from 'react';
import { useGatewayStore } from '../store/gateway';
import { useChatStore } from '../store/chat';
import { AGENT_CONFIG } from '../lib/constants';

export function MobileChat() {
  const { selectedAgent, setSelectedAgent, message, setMessage } = useChatStore();
  const chatHistory = useGatewayStore((s) => s.chatHistory);
  const chatStreaming = useGatewayStore((s) => s.chatStreaming);
  const sendChat = useGatewayStore((s) => s.sendChat);
  const connectionState = useGatewayStore((s) => s.connectionState);
  const scrollRef = useRef<HTMLDivElement>(null);

  const messages = chatHistory[selectedAgent] || [];
  const isStreaming = chatStreaming[selectedAgent] || false;
  const isConnected = connectionState === 'connected';

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, isStreaming]);

  const handleSend = () => {
    const text = message.trim();
    if (!text || !isConnected) return;
    sendChat(selectedAgent, text);
    setMessage('');
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      overflow: 'hidden',
    }}>
      {/* Agent selector — horizontal pill scroll */}
      <div style={{
        display: 'flex',
        gap: 6,
        padding: '10px 12px',
        overflowX: 'auto',
        borderBottom: '1px solid var(--border-subtle)',
        flexShrink: 0,
        WebkitOverflowScrolling: 'touch',
      }}>
        {Object.entries(AGENT_CONFIG).map(([id, cfg]) => {
          const active = id === selectedAgent;
          return (
            <button
              key={id}
              onClick={() => setSelectedAgent(id)}
              style={{
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '5px 12px',
                borderRadius: 20,
                border: `1px solid ${active ? cfg.color : 'var(--border-subtle)'}`,
                background: active ? `${cfg.color}18` : 'transparent',
                color: active ? cfg.color : 'var(--text-secondary)',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                fontWeight: active ? 700 : 500,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              <span style={{ fontSize: 12 }}>{cfg.glyph}</span>
              {cfg.name}
            </button>
          );
        })}
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {messages.length === 0 && (
          <div style={{
            textAlign: 'center',
            padding: '40px 20px',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--text-tertiary)',
          }}>
            Send a message to {AGENT_CONFIG[selectedAgent]?.name || selectedAgent}
          </div>
        )}
        {messages.map((msg) => {
          const isUser = msg.role === 'user';
          return (
            <div
              key={msg.id}
              style={{
                maxWidth: '85%',
                alignSelf: isUser ? 'flex-end' : 'flex-start',
                background: isUser
                  ? 'rgba(0,255,136,0.08)'
                  : 'var(--bg-card)',
                border: `1px solid ${isUser ? 'rgba(0,255,136,0.15)' : 'var(--border-card)'}`,
                borderRadius: isUser ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                padding: '8px 12px',
              }}
            >
              <div style={{
                fontFamily: 'var(--font-body)',
                fontSize: 13,
                color: 'var(--text-primary)',
                lineHeight: 1.4,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}>
                {msg.content}
              </div>
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 8,
                color: 'var(--text-tertiary)',
                marginTop: 4,
                textAlign: isUser ? 'right' : 'left',
              }}>
                {msg.state === 'streaming' ? '⟳ streaming...' :
                 msg.state === 'error' ? '⚠ error' :
                 new Date(msg.timestamp).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          );
        })}
        {isStreaming && messages[messages.length - 1]?.state !== 'streaming' && (
          <div style={{
            alignSelf: 'flex-start',
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--text-tertiary)',
            padding: '8px 12px',
          }}>
            <span className="dot-pulse" style={{
              display: 'inline-block',
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: AGENT_CONFIG[selectedAgent]?.color || 'var(--accent-cyan)',
              marginRight: 6,
            }} />
            {AGENT_CONFIG[selectedAgent]?.name} is typing...
          </div>
        )}
      </div>

      {/* Input */}
      <div style={{
        display: 'flex',
        gap: 8,
        padding: '10px 12px',
        borderTop: '1px solid var(--border-subtle)',
        background: 'var(--bg-glass)',
        paddingBottom: 'calc(10px + env(safe-area-inset-bottom, 0px))',
      }}>
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
          placeholder={isConnected ? `Message ${AGENT_CONFIG[selectedAgent]?.name || ''}...` : 'Disconnected'}
          disabled={!isConnected}
          style={{
            flex: 1,
            background: 'var(--input-bg)',
            border: '1px solid var(--input-border)',
            borderRadius: 20,
            padding: '8px 14px',
            fontFamily: 'var(--font-body)',
            fontSize: 13,
            color: 'var(--text-primary)',
            outline: 'none',
          }}
        />
        <button
          onClick={handleSend}
          disabled={!isConnected || !message.trim()}
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            border: 'none',
            background: isConnected && message.trim() ? 'var(--accent-green)' : 'var(--border-subtle)',
            color: isConnected && message.trim() ? '#000' : 'var(--text-tertiary)',
            fontSize: 14,
            cursor: isConnected && message.trim() ? 'pointer' : 'not-allowed',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            transition: 'all 0.2s',
          }}
        >
          ↑
        </button>
      </div>
    </div>
  );
}
