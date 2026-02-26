import { useState, useRef, useEffect, useCallback } from 'react';
import {
  type Task,
  useUpdateTask,
  useDeleteTask,
  useTaskComments,
  useCreateComment,
  useDeleteComment,
  useTaskDeliverables,
} from '../lib/tasks-api';
import { useGatewayStore } from '../store/gateway';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUSES: Task['status'][] = ['backlog', 'active', 'review', 'done', 'blocked'];
const STATUS_COLORS: Record<string, string> = {
  backlog: 'var(--text-tertiary)',
  active: 'var(--accent-cyan)',
  review: 'var(--accent-gold)',
  done: 'var(--accent-green)',
  blocked: 'var(--accent-red)',
};

const PRIORITIES: Task['priority'][] = ['critical', 'high', 'medium', 'low'];
const PRIORITY_COLORS: Record<string, string> = {
  critical: 'var(--accent-red)',
  high: 'var(--accent-gold)',
  medium: 'var(--accent-green)',
  low: 'var(--text-tertiary)',
};

// ---------------------------------------------------------------------------
// Pill button
// ---------------------------------------------------------------------------

function Pill({ label, active, color, onClick }: {
  label: string; active: boolean; color: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? color : 'transparent',
        color: active ? 'var(--bg-primary)' : color,
        border: `1px solid ${active ? color : 'var(--border-subtle)'}`,
        borderRadius: 6,
        padding: '3px 10px',
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        fontWeight: active ? 700 : 400,
        cursor: 'pointer',
        textTransform: 'capitalize',
        transition: `all var(--transition-speed) var(--transition-ease)`,
      }}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: 'var(--font-mono)',
      fontSize: 9,
      fontWeight: 600,
      color: 'var(--text-tertiary)',
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      marginBottom: 6,
    }}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TaskDetailPanel
// ---------------------------------------------------------------------------

export function TaskDetailPanel({ task, onClose }: {
  task: Task;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const agents = useGatewayStore((s) => s.agents);

  const { data: comments = [] } = useTaskComments(task.id);
  const createComment = useCreateComment();
  const deleteComment = useDeleteComment();
  const { data: deliverables = [] } = useTaskDeliverables(task.id);

  // Local editable state
  const [title, setTitle] = useState(task.title);
  const [editingTitle, setEditingTitle] = useState(false);
  const [description, setDescription] = useState(task.description || '');
  const [editingDesc, setEditingDesc] = useState(false);
  const [domain, setDomain] = useState(task.domain);
  const [editingDomain, setEditingDomain] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [visible, setVisible] = useState(false);

  // Sync local state when task changes
  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description || '');
    setDomain(task.domain);
    setConfirmDelete(false);
  }, [task.id, task.title, task.description, task.domain]);

  // Slide-in animation
  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  // Click outside to close
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        handleClose();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleClose = useCallback(() => {
    setVisible(false);
    setTimeout(onClose, 250);
  }, [onClose]);

  // Escape key
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') handleClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [handleClose]);

  // Patch helpers
  const patch = (fields: Partial<Task>) => {
    updateTask.mutate({ id: task.id, ...fields } as any);
  };

  const commitTitle = () => {
    setEditingTitle(false);
    if (title.trim() && title !== task.title) patch({ title: title.trim() });
    else setTitle(task.title);
  };

  const commitDescription = () => {
    setEditingDesc(false);
    if (description !== (task.description || '')) patch({ description } as any);
  };

  const commitDomain = () => {
    setEditingDomain(false);
    if (domain.trim() && domain !== task.domain) patch({ domain: domain.trim() });
    else setDomain(task.domain);
  };

  const handleDelete = () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    deleteTask.mutate(task.id);
    onClose();
  };

  const handleAddComment = () => {
    if (!commentText.trim()) return;
    createComment.mutate({ taskId: task.id, body: commentText.trim(), author: 'atlas', comment_type: 'note' });
    setCommentText('');
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <>
      {/* Backdrop */}
      <div style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        zIndex: 900,
        opacity: visible ? 1 : 0,
        transition: 'opacity 250ms ease',
      }} />

      {/* Panel */}
      <div
        ref={panelRef}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 420,
          maxWidth: '100vw',
          zIndex: 901,
          background: 'var(--bg-primary)',
          borderLeft: '1px solid var(--border-glass)',
          boxShadow: '-8px 0 32px rgba(0,0,0,0.4)',
          backdropFilter: `blur(var(--card-blur))`,
          WebkitBackdropFilter: `blur(var(--card-blur))`,
          display: 'flex',
          flexDirection: 'column',
          transform: visible ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 250ms cubic-bezier(0.4, 0, 0.2, 1)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 18px',
          borderBottom: '1px solid var(--border-subtle)',
          flexShrink: 0,
        }}>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9,
            color: 'var(--text-tertiary)',
          }}>
            TASK #{task.id}
          </span>
          <button
            onClick={handleClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-secondary)',
              fontSize: 18,
              cursor: 'pointer',
              padding: '2px 6px',
              borderRadius: 4,
              lineHeight: 1,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
          >
            ✕
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '18px',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}>
          {/* Title */}
          {editingTitle ? (
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => { if (e.key === 'Enter') commitTitle(); if (e.key === 'Escape') { setTitle(task.title); setEditingTitle(false); } }}
              style={{
                background: 'var(--input-bg)',
                border: '1px solid var(--accent-cyan)',
                borderRadius: 'var(--card-radius)',
                padding: '8px 12px',
                fontFamily: 'var(--font-display)',
                fontSize: 16,
                fontWeight: 700,
                color: 'var(--text-primary)',
                outline: 'none',
                width: '100%',
              }}
            />
          ) : (
            <h2
              onClick={() => setEditingTitle(true)}
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 16,
                fontWeight: 700,
                color: 'var(--text-primary)',
                lineHeight: 1.3,
                cursor: 'text',
                margin: 0,
                padding: '8px 0',
                borderBottom: '1px solid transparent',
                transition: 'border-color var(--transition-speed)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderBottomColor = 'var(--border-subtle)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderBottomColor = 'transparent'; }}
            >
              {task.title}
            </h2>
          )}

          {/* Status */}
          <div>
            <SectionLabel>Status</SectionLabel>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {STATUSES.map(s => (
                <Pill
                  key={s}
                  label={s}
                  active={task.status === s}
                  color={STATUS_COLORS[s]}
                  onClick={() => patch({ status: s })}
                />
              ))}
            </div>
          </div>

          {/* Priority */}
          <div>
            <SectionLabel>Priority</SectionLabel>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {PRIORITIES.map(p => (
                <Pill
                  key={p}
                  label={p}
                  active={task.priority === p}
                  color={PRIORITY_COLORS[p]}
                  onClick={() => patch({ priority: p })}
                />
              ))}
            </div>
          </div>

          {/* Domain */}
          <div>
            <SectionLabel>Domain</SectionLabel>
            {editingDomain ? (
              <input
                autoFocus
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                onBlur={commitDomain}
                onKeyDown={(e) => { if (e.key === 'Enter') commitDomain(); if (e.key === 'Escape') { setDomain(task.domain); setEditingDomain(false); } }}
                style={{
                  background: 'var(--input-bg)',
                  border: '1px solid var(--accent-cyan)',
                  borderRadius: 6,
                  padding: '4px 10px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  color: 'var(--text-primary)',
                  outline: 'none',
                  width: 140,
                }}
              />
            ) : (
              <span
                onClick={() => setEditingDomain(true)}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  color: 'var(--text-secondary)',
                  background: 'var(--bg-glass)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 6,
                  padding: '4px 10px',
                  cursor: 'text',
                  display: 'inline-block',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                {task.domain || 'none'}
              </span>
            )}
          </div>

          {/* Agent assignment */}
          <div>
            <SectionLabel>Agent</SectionLabel>
            <select
              value={task.agent || ''}
              onChange={(e) => patch({ agent: e.target.value || null } as any)}
              style={{
                background: 'var(--input-bg)',
                border: '1px solid var(--input-border)',
                borderRadius: 6,
                padding: '6px 10px',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--text-primary)',
                outline: 'none',
                cursor: 'pointer',
                minWidth: 160,
                appearance: 'none',
                WebkitAppearance: 'none',
              }}
            >
              <option value="" style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)' }}>Unassigned</option>
              {agents.map(a => (
                <option key={a.id} value={a.id} style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>

          {/* Description */}
          <div>
            <SectionLabel>Description</SectionLabel>
            {editingDesc ? (
              <textarea
                autoFocus
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={commitDescription}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { setDescription(task.description || ''); setEditingDesc(false); }
                }}
                rows={5}
                style={{
                  width: '100%',
                  background: 'var(--input-bg)',
                  border: '1px solid var(--accent-cyan)',
                  borderRadius: 'var(--card-radius)',
                  padding: '10px 12px',
                  fontFamily: 'var(--font-body)',
                  fontSize: 12,
                  color: 'var(--text-primary)',
                  outline: 'none',
                  resize: 'vertical',
                  lineHeight: 1.5,
                }}
              />
            ) : (
              <div
                onClick={() => setEditingDesc(true)}
                style={{
                  fontFamily: 'var(--font-body)',
                  fontSize: 12,
                  color: description ? 'var(--text-secondary)' : 'var(--text-tertiary)',
                  lineHeight: 1.6,
                  cursor: 'text',
                  padding: '8px 12px',
                  background: 'var(--bg-glass)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--card-radius)',
                  minHeight: 60,
                  whiteSpace: 'pre-wrap',
                  transition: 'border-color var(--transition-speed)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--border-glass)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}
              >
                {description || 'Click to add description...'}
              </div>
            )}
          </div>

          {/* Deliverables */}
          {deliverables.length > 0 && (
            <div>
              <SectionLabel>Deliverables</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {deliverables.map(d => (
                  <div key={d.id} style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '6px 10px',
                    background: 'var(--bg-glass)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 8,
                  }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-secondary)' }}>
                      {d.label}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--accent-cyan)' }}>
                      {d.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Comments */}
          <div>
            <SectionLabel>Comments {comments.length > 0 && `(${comments.length})`}</SectionLabel>

            {/* Add comment */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              <input
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddComment(); }}
                placeholder="Add a comment..."
                style={{
                  flex: 1,
                  background: 'var(--input-bg)',
                  border: '1px solid var(--input-border)',
                  borderRadius: 8,
                  padding: '6px 10px',
                  fontFamily: 'var(--font-body)',
                  fontSize: 11,
                  color: 'var(--text-primary)',
                  outline: 'none',
                }}
              />
              <button
                onClick={handleAddComment}
                disabled={!commentText.trim()}
                style={{
                  background: commentText.trim() ? 'var(--accent-cyan)' : 'var(--bg-glass)',
                  color: commentText.trim() ? 'var(--bg-primary)' : 'var(--text-tertiary)',
                  border: 'none',
                  borderRadius: 8,
                  padding: '6px 12px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: commentText.trim() ? 'pointer' : 'default',
                  transition: `all var(--transition-speed) var(--transition-ease)`,
                }}
              >
                Post
              </button>
            </div>

            {/* Comment list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {comments.map(c => (
                <div key={c.id} style={{
                  padding: '8px 10px',
                  background: 'var(--bg-glass)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 8,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600, color: 'var(--accent-gold)' }}>
                        {c.author}
                      </span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-tertiary)' }}>
                        {c.comment_type}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-tertiary)' }}>
                        {new Date(c.created_at).toLocaleDateString()}
                      </span>
                      <button
                        onClick={() => deleteComment.mutate({ taskId: task.id, commentId: c.id })}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--text-tertiary)',
                          fontSize: 10,
                          cursor: 'pointer',
                          padding: '0 2px',
                          lineHeight: 1,
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-red)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; }}
                        title="Delete comment"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                  <div style={{
                    fontFamily: 'var(--font-body)',
                    fontSize: 11,
                    color: 'var(--text-secondary)',
                    lineHeight: 1.5,
                    whiteSpace: 'pre-wrap',
                  }}>
                    {c.body}
                  </div>
                </div>
              ))}
              {comments.length === 0 && (
                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: 'var(--text-tertiary)',
                  textAlign: 'center',
                  padding: '12px 0',
                  opacity: 0.6,
                }}>
                  No comments yet
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer — delete */}
        <div style={{
          padding: '12px 18px',
          borderTop: '1px solid var(--border-subtle)',
          flexShrink: 0,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-tertiary)' }}>
            Created {new Date(task.created_at).toLocaleDateString()}
          </span>
          <button
            onClick={handleDelete}
            style={{
              background: confirmDelete ? 'var(--accent-red)' : 'transparent',
              color: confirmDelete ? 'var(--bg-primary)' : 'var(--accent-red)',
              border: `1px solid ${confirmDelete ? 'var(--accent-red)' : 'var(--border-subtle)'}`,
              borderRadius: 6,
              padding: '4px 12px',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              fontWeight: 600,
              cursor: 'pointer',
              transition: `all var(--transition-speed) var(--transition-ease)`,
            }}
          >
            {confirmDelete ? 'Confirm Delete' : 'Delete'}
          </button>
        </div>
      </div>
    </>
  );
}
