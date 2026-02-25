/**
 * Notifications API — TanStack Query hooks + Zustand toast store
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import { useEffect, useRef } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  priority: string;
  category: string;
  read: number;
  created_at: string;
  expires_at: string | null;
}

interface NotificationsResponse {
  success: boolean;
  notifications: Notification[];
  unreadCount: number;
}

export interface Toast {
  id: string;
  type: string;
  title: string;
  body: string;
  priority: string;
  addedAt: number;
}

// ---------------------------------------------------------------------------
// Toast Store (Zustand)
// ---------------------------------------------------------------------------

interface ToastStore {
  toasts: Toast[];
  addToast: (n: Omit<Toast, 'addedAt'>) => void;
  removeToast: (id: string) => void;
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  addToast: (t) =>
    set((state) => {
      // Max 3 visible
      const next = [{ ...t, addedAt: Date.now() }, ...state.toasts].slice(0, 3);
      return { toasts: next };
    }),
  removeToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

const BASE = '/api/mc';

async function fetchNotifications(unread = false, limit = 20): Promise<NotificationsResponse> {
  const params = new URLSearchParams();
  if (unread) params.set('unread', 'true');
  params.set('limit', String(limit));
  const res = await fetch(`${BASE}/notifications?${params}`);
  if (!res.ok) throw new Error('Failed to fetch notifications');
  return res.json();
}

async function markRead(id: string): Promise<void> {
  await fetch(`${BASE}/notifications/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ read: 1 }),
  });
}

async function markAllRead(): Promise<void> {
  await fetch(`${BASE}/notifications/read-all`, { method: 'POST' });
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useNotifications(limit = 20) {
  const queryClient = useQueryClient();
  const prevIdsRef = useRef<Set<string>>(new Set());
  const addToast = useToastStore((s) => s.addToast);

  const query = useQuery<NotificationsResponse>({
    queryKey: ['notifications', limit],
    queryFn: () => fetchNotifications(false, limit),
    refetchInterval: 30_000,
    staleTime: 10_000,
    retry: 1,
    throwOnError: false,
  });

  // Detect new high-priority notifications → trigger toast
  useEffect(() => {
    if (!query.data?.notifications) return;
    const currentIds = new Set(query.data.notifications.map((n) => n.id));

    for (const n of query.data.notifications) {
      if (!prevIdsRef.current.has(n.id) && prevIdsRef.current.size > 0 && !n.read) {
        // New unread notification
        if (n.priority === 'high') {
          addToast({
            id: n.id,
            type: n.type,
            title: n.title,
            body: n.body,
            priority: n.priority,
          });
        }
      }
    }
    prevIdsRef.current = currentIds;
  }, [query.data, addToast]);

  const markReadMutation = useMutation({
    mutationFn: markRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markAllReadMutation = useMutation({
    mutationFn: markAllRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  return {
    notifications: query.data?.notifications ?? [],
    unreadCount: query.data?.unreadCount ?? 0,
    isLoading: query.isLoading,
    markRead: (id: string) => markReadMutation.mutate(id),
    markAllRead: () => markAllReadMutation.mutate(),
    refresh: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  };
}
