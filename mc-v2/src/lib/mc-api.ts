/**
 * MC API hooks — regime, portfolio
 * Uses TanStack Query (same as production-api)
 */
import { useQuery } from '@tanstack/react-query';

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
};

// ---------------------------------------------------------------------------
// Regime
// ---------------------------------------------------------------------------

export interface RegimeData {
  signal: 'GREEN' | 'YELLOW' | 'RED' | 'NEUTRAL';
  label: string;
  data: {
    spy_price: number;
    spy_trend: string;
    vix: number;
    vix_level: string;
    yield_10y?: number;
  };
  strategy: {
    position_sizing: string;
    strategies: string;
    stops: string;
    new_entries: string;
  };
  created_at?: string;
}

export function useRegime() {
  return useQuery({
    queryKey: ['regime'],
    queryFn: () => fetcher('/api/mc/regime'),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Portfolio
// ---------------------------------------------------------------------------

export interface PortfolioData {
  starting_bankroll: number;
  portfolio_value: number;
  realized_pnl: number;
  unrealized_pnl: number;
  open_positions: number;
  closed_trades: number;
  win_rate: number;
  open_exposure: number;
  positions: Array<{
    ticker: string;
    direction: string;
    vehicle: string;
    strike: number;
    expiry: string;
    status: string;
  }>;
}

export function usePortfolio() {
  return useQuery({
    queryKey: ['portfolio'],
    queryFn: () => fetcher('/api/mc/portfolio'),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}
