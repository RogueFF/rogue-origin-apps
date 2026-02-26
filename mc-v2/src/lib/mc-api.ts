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
    entry_price: number;
    quantity: number;
    entry_date: string;
    target_price: number | null;
    stop_loss: number | null;
    current_price: number | null;
    current_pnl: number;
    pnl: number | null;
    notes: string | null;
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

// ---------------------------------------------------------------------------
// Market News (from widgets)
// ---------------------------------------------------------------------------

export interface NewsItem {
  ticker: string;
  title: string;
  publisher: string;
  url: string;
  published: string;
  sentiment: string | null;
  mentions: number;
}

export function useMarketNews() {
  return useQuery({
    queryKey: ['market-news'],
    queryFn: async () => {
      const data = await fetcher('/api/mc/widgets');
      const raw = data?.data?.market_news;
      if (!raw) return { items: [] };
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return parsed as { updated_at: string; items: NewsItem[] };
    },
    refetchInterval: 300_000,
    staleTime: 120_000,
  });
}
