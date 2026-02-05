'use client';

import { useEffect, useState } from 'react';
import type { FundingSpreadOpportunity } from '../lib/utils/screener';

export type { FundingSpreadOpportunity };

export function useFundingScreener() {
  const [data, setData] = useState<FundingSpreadOpportunity[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setError(null);
      const res = await fetch('/api/screener');
      if (!res.ok) throw new Error('Failed to fetch screener data');
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  return { data, loading, error };
}
