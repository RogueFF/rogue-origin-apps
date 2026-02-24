import { useState, useRef, useCallback } from 'react';
import { useTasks, useCreateTask, useUpdateTask, type Task } from '../lib/tasks-api';
import { useGatewayStore } from '../store/gateway';
import { DepthCard } from '../components/DepthCard';
import { AGENT_GLYPHS } from '../data/mock';
import { useIsMobile } from '../hooks/useIsMobile';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUSES: Task['status'][] = ['backlog', 'active', 'review', 'done'];
const STATUS_LABELS: Record<string, string> = { backlog: 'Backlog', active: 'Active', review: 'Review', done: '✓ Done' };
const PRIORITY_COLORS: Record<string, string> = {
  critical: 'var(--accent-red)',
  high: 'var(--accent-gold)',
  medium: 'var(--accent-green)',
  low: 'var(--text-tertiary)',
};
const AGENT_COLORS: Record<string, string> = {
  main: '#22c55e', atlas: '#22c55e', kiln: '#f59e0b', razor: '#8b5cf6', meridian: '#3b82f6', hex: '#ef4444',
};
const FILTER_AGENTS = ['all', 'main', 'kiln', 'razor', 'meridian', 'hex'] as const;
const AGENT_NAMES: Record<string, string> = { main: 'Atlas', kiln: 'Kiln', razor: 'Razor', meridian: 'Meridian', hex: 'Hex' };

function timeAgo(ts: string): string {
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 60) return 'now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

// ---------------------------------------------------------------------------
// TaskCard
// ---------------------------------------------------------------------------

function TaskCard({ task, onDispatch }: {
  task: Task;
  onDispatch: (taskId: number, agentId: string) => void;
}) {
  const agents = useGatewayStore((s) => s.agents);
  const [showDispatch, setShowDispatch] = useState(false);
  const isDone = task.status === 'done';

  return (
    <DepthCard
      className="liquid-glass"
      style={{
        borderRadius: 'var(--card-radius)',
        padding: '10px 12px',
        cursor: 'grab',
        opacity: isDone ? 0.6 : 1,
        transition: 'all 300ms ease',
        position: 'relative',
      }}
    >
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', String(task.id));
          e.dataTransfer.effectAllowed = 'move';
          (e.currentTarget.parentElement as HTMLElement).style.opacity = '0.4';
        }}
        onDragEnd={(e) => {
          (e.currentTarget.parentElement as HTMLElement).style.opacity = '';
        }}
        style={{ cursor: 'grab' }}
      >
        {/* Title row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 6 }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%', marginTop: 4, flexShrink: 0,
            background: PRIORITY_COLORS[task.priority] || 'var(--text-tertiary)',
          }} />
          <span style={{
            fontFamily: 'var(--font-body)',
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--text-primary)',
            lineHeight: 1.3,
            flex: 1,
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}>
            {task.title}
          </span>
        </div>

        {/* Meta row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {/* Domain tag */}
            {task.domain && (
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 8,
                color: 'var(--text-tertiary)',
                background: 'rgba(255,255,255,0.05)',
                padding: '1px 5px',
                borderRadius: 4,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}>
                {task.domain}
              </span>
            )}

            {/* Assignee */}
            {task.agent ? (
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                color: AGENT_COLORS[task.agent] || 'var(--text-secondary)',
                display: 'flex',
                alignItems: 'center',
                gap: 3,
              }}>
                <span style={{ fontSize: 10 }}>{AGENT_GLYPHS[task.agent] || '◆'}</span>
                {AGENT_NAMES[task.agent] || task.agent}
                <span style={{ color: 'var(--text-tertiary)', fontSize: 8 }}>{timeAgo(task.updated_at)}</span>
              </span>
            ) : (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
                unassigned
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {/* Comment count */}
            {(task.comment_count ?? 0) > 0 && (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-tertiary)' }}>
                💬 {task.comment_count}
              </span>
            )}

            {/* Dispatch button */}
            {!isDone && !task.agent && (
              <div style={{ position: 'relative' }}>
                <button
                  onClick={(e) => { e.stopPropagation(); setShowDispatch(!showDispatch); }}
                  style={{
                    background: 'none',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 4,
                    padding: '1px 4px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 9,
                    color: 'var(--accent-gold)',
                    cursor: 'pointer',
                  }}
                  title="Dispatch to agent"
                >
                  ⚡
                </button>
                {showDispatch && (
                  <div style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
                    marginTop: 4,
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border-glass)',
                    borderRadius: 8,
                    padding: 4,
                    zIndex: 20,
                    minWidth: 100,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                  }}>
                    {agents.map(a => (
                      <button
                        key={a.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          onDispatch(task.id, a.id);
                          setShowDispatch(false);
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          width: '100%',
                          background: 'none',
                          border: 'none',
                          padding: '4px 8px',
                          borderRadius: 4,
                          cursor: 'pointer',
                          fontFamily: 'var(--font-mono)',
                          fontSize: 10,
                          color: a.color || 'var(--text-primary)',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-glass-hover)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
                      >
                        <span>{AGENT_GLYPHS[a.id] || '◆'}</span>
                        <span>{a.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </DepthCard>
  );
}

// ---------------------------------------------------------------------------
// QuickAddInput
// ---------------------------------------------------------------------------

function QuickAddInput({ status, onCreate }: { status: Task['status']; onCreate: (title: string, status: Task['status']) => void }) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && value.trim()) {
          onCreate(value.trim(), status);
          setValue('');
        }
      }}
      placeholder="New task..."
      style={{
        width: '100%',
        background: 'var(--input-bg)',
        border: '1px solid var(--input-border)',
        borderRadius: 'var(--card-radius)',
        padding: '6px 10px',
        fontFamily: 'var(--font-body)',
        fontSize: 11,
        color: 'var(--text-primary)',
        outline: 'none',
        marginBottom: 6,
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// KanbanColumn (desktop)
// ---------------------------------------------------------------------------

function KanbanColumn({ status, tasks, onDrop, onCreate, onDispatch, collapsed, onToggle }: {
  status: Task['status'];
  tasks: Task[];
  onDrop: (taskId: number, newStatus: Task['status']) => void;
  onCreate?: (title: string, status: Task['status']) => void;
  onDispatch: (taskId: number, agentId: string) => void;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const isDone = status === 'done';

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => setDragOver(false), []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const taskId = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (!isNaN(taskId)) onDrop(taskId, status);
  }, [onDrop, status]);

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        flex: 1,
        minWidth: 200,
        display: 'flex',
        flexDirection: 'column',
        background: dragOver ? 'rgba(0,240,255,0.03)' : 'transparent',
        border: `1px solid ${dragOver ? 'var(--accent-cyan)' : 'var(--border-subtle)'}`,
        borderRadius: 'var(--card-radius)',
        padding: '10px',
        transition: 'all 200ms ease',
        overflow: 'hidden',
      }}
    >
      {/* Column header */}
      <div
        onClick={isDone ? onToggle : undefined}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: collapsed ? 0 : 8,
          cursor: isDone ? 'pointer' : 'default',
        }}
      >
        <span style={{
          fontFamily: 'var(--font-display)',
          fontSize: 11,
          fontWeight: 800,
          color: 'var(--text-primary)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}>
          {STATUS_LABELS[status]}
        </span>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 9,
          color: 'var(--text-tertiary)',
          background: 'rgba(255,255,255,0.05)',
          padding: '1px 6px',
          borderRadius: 8,
        }}>
          {tasks.length}
        </span>
      </div>

      {!collapsed && (
        <>
          {/* Quick add */}
          {onCreate && !isDone && (
            <QuickAddInput status={status} onCreate={onCreate} />
          )}

          {/* Cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, overflow: 'auto' }}>
            {tasks.map(task => (
              <TaskCard key={task.id} task={task} onDispatch={onDispatch} />
            ))}
            {tasks.length === 0 && (
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                color: 'var(--text-tertiary)',
                padding: '16px 0',
                textAlign: 'center',
                opacity: 0.6,
              }}>
                {isDone ? 'No completed tasks' : 'Drop tasks here'}
              </div>
            )}
          </div>

          {/* Drop indicator */}
          {dragOver && (
            <div style={{
              height: 2,
              background: 'var(--accent-cyan)',
              borderRadius: 1,
              boxShadow: '0 0 8px var(--accent-cyan)',
              marginTop: 4,
              transition: 'opacity 200ms',
            }} />
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MobileSection
// ---------------------------------------------------------------------------

function MobileSection({ status, tasks, onStatusChange, onDispatch }: {
  status: Task['status'];
  tasks: Task[];
  onStatusChange: (taskId: number, newStatus: Task['status']) => void;
  onDispatch: (taskId: number, agentId: string) => void;
}) {
  const [expanded, setExpanded] = useState(status !== 'done');

  return (
    <div style={{ marginBottom: 8 }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'var(--bg-glass)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--card-radius)',
          padding: '10px 14px',
          cursor: 'pointer',
        }}
      >
        <span style={{
          fontFamily: 'var(--font-display)',
          fontSize: 12,
          fontWeight: 800,
          color: 'var(--text-primary)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}>
          {STATUS_LABELS[status]}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--text-tertiary)',
            background: 'rgba(255,255,255,0.05)',
            padding: '1px 6px',
            borderRadius: 8,
          }}>
            {tasks.length}
          </span>
          <span style={{ color: 'var(--text-tertiary)', fontSize: 10 }}>
            {expanded ? '▾' : '▸'}
          </span>
        </div>
      </button>
      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '6px 0' }}>
          {tasks.map(task => (
            <div key={task.id} style={{ position: 'relative' }}>
              <TaskCard task={task} onDispatch={onDispatch} />
              {/* Status move buttons */}
              <div style={{
                display: 'flex',
                gap: 4,
                justifyContent: 'flex-end',
                padding: '2px 4px',
              }}>
                {STATUSES.filter(s => s !== task.status).map(s => (
                  <button
                    key={s}
                    onClick={() => onStatusChange(task.id, s)}
                    style={{
                      background: 'none',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 4,
                      padding: '2px 6px',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 8,
                      color: 'var(--text-tertiary)',
                      cursor: 'pointer',
                      textTransform: 'uppercase',
                    }}
                  >
                    → {s}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {tasks.length === 0 && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-tertiary)', padding: '8px 0', textAlign: 'center' }}>
              Empty
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tasks View
// ---------------------------------------------------------------------------

export function Tasks() {
  const { data: tasks = [], isError } = useTasks();
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const isMobile = useIsMobile();

  const [agentFilter, setAgentFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [doneCollapsed, setDoneCollapsed] = useState(true);

  // Filter tasks
  const filtered = tasks.filter(t => {
    if (agentFilter !== 'all' && t.agent !== agentFilter) return false;
    if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const byStatus = (status: Task['status']) => {
    const col = filtered.filter(t => t.status === status);
    // Sort: critical first, then high, medium, low; within same priority by updated_at desc
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    return col.sort((a, b) => {
      const pd = (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9);
      if (pd !== 0) return pd;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
  };

  // Done: only last 48h
  const doneFiltered = filtered
    .filter(t => t.status === 'done')
    .filter(t => Date.now() - new Date(t.updated_at).getTime() < 48 * 60 * 60 * 1000)
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

  const handleDrop = useCallback((taskId: number, newStatus: Task['status']) => {
    updateTask.mutate({ id: taskId, status: newStatus });
  }, [updateTask]);

  const handleCreate = useCallback((title: string, status: Task['status']) => {
    createTask.mutate({ title, status, priority: 'medium', domain: 'ops' });
  }, [createTask]);

  const handleDispatch = useCallback((taskId: number, agentId: string) => {
    updateTask.mutate({ id: taskId, agent: agentId, status: 'active' });
  }, [updateTask]);

  // ── Mobile layout ──
  if (isMobile) {
    return (
      <div style={{ padding: '12px 16px', overflow: 'auto', height: '100%' }}>
        {/* Filter bar */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
            {FILTER_AGENTS.map(f => (
              <button
                key={f}
                onClick={() => setAgentFilter(f)}
                style={{
                  background: agentFilter === f ? 'rgba(255,255,255,0.08)' : 'transparent',
                  border: `1px solid ${agentFilter === f ? 'var(--border-glass)' : 'transparent'}`,
                  borderRadius: 6,
                  padding: '3px 8px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9,
                  color: f === 'all' ? 'var(--text-secondary)' : AGENT_COLORS[f] || 'var(--text-secondary)',
                  cursor: 'pointer',
                  opacity: agentFilter === f ? 1 : 0.7,
                }}>
                {f === 'all' ? 'All' : (AGENT_GLYPHS[f] || '') + ' ' + (AGENT_NAMES[f] || f)}
              </button>
            ))}
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks..."
            style={{
              width: '100%',
              background: 'var(--input-bg)',
              border: '1px solid var(--input-border)',
              borderRadius: 'var(--card-radius)',
              padding: '8px 12px',
              fontFamily: 'var(--font-body)',
              fontSize: 12,
              color: 'var(--text-primary)',
              outline: 'none',
            }}
          />
        </div>
        {STATUSES.map(s => (
          <MobileSection
            key={s}
            status={s}
            tasks={s === 'done' ? doneFiltered : byStatus(s)}
            onStatusChange={handleDrop}
            onDispatch={handleDispatch}
          />
        ))}
      </div>
    );
  }

  // ── Desktop Kanban ──
  return (
    <div style={{ padding: '16px 20px', overflow: 'hidden', height: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* Filter bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {FILTER_AGENTS.map(f => (
            <button
              key={f}
              onClick={() => setAgentFilter(f)}
              style={{
                background: agentFilter === f ? 'rgba(255,255,255,0.08)' : 'transparent',
                border: `1px solid ${agentFilter === f ? 'var(--border-glass)' : 'transparent'}`,
                borderRadius: 6,
                padding: '3px 8px',
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                color: f === 'all' ? (agentFilter === f ? 'var(--text-primary)' : 'var(--text-tertiary)')
                  : AGENT_COLORS[f] || 'var(--text-secondary)',
                cursor: 'pointer',
                opacity: agentFilter === f ? 1 : 0.7,
                transition: 'all 150ms',
                textTransform: 'capitalize',
              }}
            >
              {f === 'all' ? 'All' : (AGENT_GLYPHS[f] || '') + ' ' + (AGENT_NAMES[f] || f)}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tasks..."
          style={{
            flex: 1,
            maxWidth: 260,
            background: 'var(--input-bg)',
            border: '1px solid var(--input-border)',
            borderRadius: 'var(--card-radius)',
            padding: '6px 12px',
            fontFamily: 'var(--font-body)',
            fontSize: 11,
            color: 'var(--text-primary)',
            outline: 'none',
          }}
        />
        {isError && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--accent-red)' }}>
            ⚠ Failed to load tasks
          </span>
        )}
      </div>

      {/* Kanban columns */}
      <div data-two-col="" style={{ display: 'flex', gap: 10, flex: 1, minHeight: 0 }}>
        <KanbanColumn status="backlog" tasks={byStatus('backlog')} onDrop={handleDrop} onCreate={handleCreate} onDispatch={handleDispatch} />
        <KanbanColumn status="active" tasks={byStatus('active')} onDrop={handleDrop} onCreate={handleCreate} onDispatch={handleDispatch} />
        <KanbanColumn status="review" tasks={byStatus('review')} onDrop={handleDrop} onDispatch={handleDispatch} />
        <KanbanColumn
          status="done"
          tasks={doneFiltered}
          onDrop={handleDrop}
          onDispatch={handleDispatch}
          collapsed={doneCollapsed}
          onToggle={() => setDoneCollapsed(!doneCollapsed)}
        />
      </div>
    </div>
  );
}
