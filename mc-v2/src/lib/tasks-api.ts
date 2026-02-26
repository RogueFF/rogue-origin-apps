/**
 * Tasks API — TanStack Query hooks with optimistic updates
 * Proxy: /api/mc/tasks → mission-control-api.workers.dev/api/tasks
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getGatewayClient } from './gateway-client';

export interface Task {
  id: number;
  title: string;
  description?: string;
  status: 'backlog' | 'active' | 'review' | 'done' | 'blocked';
  priority: 'critical' | 'high' | 'medium' | 'low';
  domain: string;
  agent: string | null;
  created_at: string;
  updated_at: string;
  comment_count?: number;
  clickup_id?: string;
}

export interface TaskComment {
  id: number;
  task_id: number;
  body: string;
  author: string;
  comment_type: string;
  created_at: string;
}

export interface TaskDeliverable {
  id: number;
  task_id: number;
  title: string;
  url: string | null;
  content: string | null;
  deliverable_type: string;
  author: string;
  created_at: string;
}

interface TasksResponse {
  success: boolean;
  data: Task[];
}

interface TaskResponse {
  success: boolean;
  data: Task;
}

const BASE = '/api/mc/tasks';

async function fetchJson<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function useTasks() {
  return useQuery<Task[]>({
    queryKey: ['tasks'],
    queryFn: async () => {
      const resp = await fetchJson<TasksResponse>(BASE);
      return resp.data || [];
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

// ---------------------------------------------------------------------------
// Mutations with optimistic updates
// ---------------------------------------------------------------------------

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (task: Partial<Task>) => {
      const resp = await fetchJson<TaskResponse>(BASE, {
        method: 'POST',
        body: JSON.stringify(task),
      });
      return resp.data;
    },
    onMutate: async (newTask) => {
      await qc.cancelQueries({ queryKey: ['tasks'] });
      const prev = qc.getQueryData<Task[]>(['tasks']);
      const optimistic: Task = {
        id: -Date.now(),
        title: newTask.title || '',
        status: (newTask.status as Task['status']) || 'backlog',
        priority: (newTask.priority as Task['priority']) || 'medium',
        domain: newTask.domain || 'ops',
        agent: newTask.agent || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...newTask,
      } as Task;
      qc.setQueryData<Task[]>(['tasks'], (old) => [...(old || []), optimistic]);
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['tasks'], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
}

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: Partial<Task> & { id: number }) => {
      // API uses assigned_agent, frontend uses agent
      const apiPatch: Record<string, unknown> = { ...patch };
      if ('agent' in apiPatch) {
        apiPatch.assigned_agent = apiPatch.agent;
        delete apiPatch.agent;
      }
      const resp = await fetchJson<TaskResponse>(`${BASE}/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(apiPatch),
      });
      return resp.data;
    },
    onMutate: async (updated) => {
      await qc.cancelQueries({ queryKey: ['tasks'] });
      const prev = qc.getQueryData<Task[]>(['tasks']);
      qc.setQueryData<Task[]>(['tasks'], (old) =>
        (old || []).map(t => t.id === updated.id ? { ...t, ...updated, updated_at: new Date().toISOString() } : t)
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['tasks'], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
}

export function useDispatchTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, agent, title, priority, domain }: {
      id: number;
      agent: string;
      title: string;
      priority: string;
      domain: string;
    }) => {
      // 1. PATCH task: assign agent + move to active
      const resp = await fetchJson<TaskResponse>(`${BASE}/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ agent, status: 'active' }),
      });

      // 2. Send dispatch message to agent via gateway
      try {
        const client = getGatewayClient();
        const sessionKey = `agent:${agent}:main`;
        const msg = `New task assigned: ${title}. Task ID: ${id}. Priority: ${priority}. Domain: ${domain}. Check the task details and begin work.`;
        await client.chatSend(sessionKey, msg);
      } catch (err) {
        console.warn('[dispatch] Gateway send failed (task still assigned):', err);
      }

      return resp.data;
    },
    onMutate: async ({ id, agent }) => {
      await qc.cancelQueries({ queryKey: ['tasks'] });
      const prev = qc.getQueryData<Task[]>(['tasks']);
      qc.setQueryData<Task[]>(['tasks'], (old) =>
        (old || []).map(t => t.id === id ? { ...t, agent, status: 'active' as const, updated_at: new Date().toISOString() } : t)
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['tasks'], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await fetchJson(`${BASE}/${id}`, { method: 'DELETE' });
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['tasks'] });
      const prev = qc.getQueryData<Task[]>(['tasks']);
      qc.setQueryData<Task[]>(['tasks'], (old) => (old || []).filter(t => t.id !== id));
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['tasks'], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export function useTaskComments(taskId: number | null) {
  return useQuery<TaskComment[]>({
    queryKey: ['task-comments', taskId],
    queryFn: async () => {
      const resp = await fetchJson<{ success: boolean; data: TaskComment[] }>(`${BASE}/${taskId}/comments`);
      return resp.data || [];
    },
    enabled: taskId !== null,
    staleTime: 15_000,
  });
}

export function useCreateComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ taskId, body, author, comment_type }: {
      taskId: number; body: string; author: string; comment_type: string;
    }) => {
      const resp = await fetchJson<{ success: boolean; data: TaskComment }>(`${BASE}/${taskId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body, author, comment_type }),
      });
      return resp.data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['task-comments', vars.taskId] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useDeleteComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ taskId, commentId }: { taskId: number; commentId: number }) => {
      await fetchJson(`${BASE}/${taskId}/comments/${commentId}`, { method: 'DELETE' });
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['task-comments', vars.taskId] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Deliverables
// ---------------------------------------------------------------------------

export function useTaskDeliverables(taskId: number | null) {
  return useQuery<TaskDeliverable[]>({
    queryKey: ['task-deliverables', taskId],
    queryFn: async () => {
      const resp = await fetchJson<{ success: boolean; data: TaskDeliverable[] }>(`${BASE}/${taskId}/deliverables`);
      return resp.data || [];
    },
    enabled: taskId !== null,
    staleTime: 15_000,
  });
}

export function useCreateDeliverable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ taskId, title, url, content, deliverable_type, author }: {
      taskId: number; title: string; url?: string; content?: string; deliverable_type?: string; author?: string;
    }) => {
      const resp = await fetchJson<{ success: boolean; data: TaskDeliverable }>(`${BASE}/${taskId}/deliverables`, {
        method: 'POST',
        body: JSON.stringify({ title, url, content, deliverable_type: deliverable_type || 'file', author: author || 'koa' }),
      });
      return resp.data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['task-deliverables', vars.taskId] });
    },
  });
}

export function useDeleteDeliverable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ taskId, deliverableId }: { taskId: number; deliverableId: number }) => {
      await fetchJson(`${BASE}/${taskId}/deliverables/${deliverableId}`, { method: 'DELETE' });
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['task-deliverables', vars.taskId] });
    },
  });
}
