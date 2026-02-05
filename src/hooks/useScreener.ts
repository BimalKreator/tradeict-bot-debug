'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FundingSpreadOpportunity } from '../lib/utils/screener';

export function useScreener() {
  const [opportunities, setOpportunities] = useState<FundingSpreadOpportunity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/screener');
      if (!res.ok) throw new Error('Failed to fetch screener data');
      const json = await res.json();
      setOpportunities(Array.isArray(json) ? json : []);
      setLastUpdated(new Date());
    } catch {
      setOpportunities([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const refresh = useCallback(() => {
    setIsLoading(true);
    return fetchData();
  }, [fetchData]);

  return { opportunities, isLoading, lastUpdated, refresh };
}
