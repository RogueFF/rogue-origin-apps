/**
 * Production API Client — TanStack Query hooks
 *
 * Endpoint: https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production
 * Uses Vite proxy in dev: /api/production → actual endpoint
 */

import { useQuery } from '@tanstack/react-query';

const API_BASE = '/api/production';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Raw API shape from ?action=scoreboard */
export interface ScoreboardRaw {
  scoreboard: {
    todayLbs: number;
    todayTarget: number;
    todayPercentage: number;
    targetRate: number;
    strain: string;
    currentHourTrimmers: number;
    currentHourBuckers: number;
    lastHourLbs: number;
    lastTimeSlot: string;
    currentTimeSlot: string;
    hoursLogged: number;
    projectedTotal: number;
    dailyGoal: number;
    hourlyRates: Array<{
      timeSlot: string;
      rate: number;
      target: number;
      trimmers: number;
      lbs: number;
      smalls: number;
      notes: string;
    }>;
  };
  timer: {
    bagsToday: number;
    bags5kgToday: number;
    lastBagTime: string;
    secondsSinceLastBag: number;
    targetSeconds: number;
    avgSecondsToday: number;
    currentTrimmers: number;
  };
  date: string;
}

/** Normalized for UI consumption */
export interface ScoreboardData {
  production: {
    totalLbs: number;
    rate: number;
    rateUnit: string;
    crew: number;
    trimmers: number;
    strain: string;
    bagCount: number;
    projected: number;
    goal: number;
    percentage: number;
    targetRate: number;
    hourlyRates: Array<{
      timeSlot: string;
      rate: number;
      target: number;
      trimmers: number;
      lbs: number;
      smalls: number;
      notes: string;
    }>;
  };
}

export interface DashboardData {
  summary: {
    totalLbs: number;
    avgRate: number;
    peakRate: number;
    totalBags: number;
    avgBagTime: string;
    shifts: number;
  };
  hourly: Array<{ hour: string; lbs: number; rate: number }>;
  strains: Array<{ name: string; lbs: number; percentage: number }>;
  status: string;
}

// ---------------------------------------------------------------------------
// Fetcher
// ---------------------------------------------------------------------------

async function fetchProduction<T>(params: Record<string, string>): Promise<T> {
  const url = new URL(API_BASE, window.location.origin);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Production API ${res.status}: ${res.statusText}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Query hooks
// ---------------------------------------------------------------------------

/** Check if currently in shift hours (7AM-5PM PST) */
function isShiftHours(): boolean {
  const now = new Date();
  const pst = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const hour = pst.getHours();
  return hour >= 7 && hour < 17;
}

/** Real-time scoreboard — 60s during shift, 5m off-shift */
export function useScoreboard() {
  return useQuery<ScoreboardData>({
    queryKey: ['production', 'scoreboard'],
    queryFn: async () => {
      const raw = await fetchProduction<ScoreboardRaw>({ action: 'scoreboard' });
      const sb = raw.scoreboard;
      const lastRate = sb.hourlyRates?.length
        ? sb.hourlyRates[sb.hourlyRates.length - 1].rate
        : sb.targetRate;
      return {
        production: {
          totalLbs: sb.todayLbs,
          rate: lastRate,
          rateUnit: 'lbs/hr',
          crew: sb.currentHourTrimmers + sb.currentHourBuckers,
          trimmers: sb.currentHourTrimmers,
          strain: sb.strain,
          bagCount: raw.timer?.bagsToday ?? 0,
          projected: sb.projectedTotal,
          goal: sb.dailyGoal,
          percentage: sb.todayPercentage,
          targetRate: sb.targetRate,
          hourlyRates: sb.hourlyRates || [],
        },
      };
    },
    refetchInterval: isShiftHours() ? 60_000 : 300_000,
    staleTime: 30_000,
    retry: 2,
    throwOnError: false,
  });
}

/** Daily dashboard with date range */
export function useDashboard(start?: string, end?: string) {
  const today = new Date().toISOString().split('T')[0];
  const startDate = start || today;
  const endDate = end || today;

  return useQuery<DashboardData>({
    queryKey: ['production', 'dashboard', startDate, endDate],
    queryFn: () => fetchProduction<DashboardData>({
      action: 'dashboard',
      start: startDate,
      end: endDate,
    }),
    refetchInterval: isShiftHours() ? 60_000 : 300_000,
    staleTime: 60_000,
    retry: 2,
    throwOnError: false,
  });
}

/** Hourly rate data for sparklines */
export function useHourlyRate() {
  return useQuery<DashboardData>({
    queryKey: ['production', 'hourly'],
    queryFn: () => fetchProduction<DashboardData>({
      action: 'dashboard',
      start: new Date().toISOString().split('T')[0],
      end: new Date().toISOString().split('T')[0],
    }),
    select: (data) => data,
    refetchInterval: isShiftHours() ? 60_000 : 300_000,
    staleTime: 30_000,
    retry: 2,
    throwOnError: false,
  });
}
