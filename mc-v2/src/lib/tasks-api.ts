/**
 * Tasks API — TanStack Query hooks with optimistic updates
 * Proxy: /api/mc/tasks → mission-control-api.workers.dev/api/tasks
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface Task {
  id: number;
  title: string;
  status: 'backlog' | 'active' | 'review' | 'done';
  priority: 'critical' | 'high' | 'medium' | 'low';
  domain: string;
  agent: string | null;
  created_at: string;
  updated_at: string;
  comment_count?: number;
  clickup_id?: string;
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
      const resp = await fetchJson<TaskResponse>(`${BASE}/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
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
