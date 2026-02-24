/**
 * System Stats API — TanStack Query hook
 * Polls /api/system every 10s for host resource usage.
 */

import { useQuery } from '@tanstack/react-query';

export interface SystemStats {
  cpu: number;
  mem: { used: number; total: number };
  disk: { used: number; total: number };
  loadAvg: number[];
  uptime: number;
  processes: Record<string, number>;
  timestamp: number;
}

export function useSystemStats() {
  return useQuery<SystemStats>({
    queryKey: ['system-stats'],
    queryFn: async () => {
      const url = new URL('/api/system', window.location.origin);
      const res = await fetch(url);
      if (!res.ok) throw new Error('System stats unavailable');
      return res.json();
    },
    refetchInterval: 10_000,
    staleTime: 5_000,
    retry: 1,
    throwOnError: false,
  });
}
