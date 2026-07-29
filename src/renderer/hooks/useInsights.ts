import { useState, useEffect, useCallback } from 'react';

export interface InsightsData {
  actionItems: string[];
  contradictions: string[];
  unresolvedPoints: string[];
  suggestions: string[];
  topics: string[];
  timestamp: number;
}

/**
 * Hook to receive real-time insights and analysis from the main process.
 */
export function useInsights() {
  const [insights, setInsights] = useState<InsightsData | null>(null);
  const [insightsHistory, setInsightsHistory] = useState<InsightsData[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const cleanup = (window as any).electronAPI?.onInsightsUpdate(
      (data: InsightsData) => {
        setInsights(data);
        setInsightsHistory((prev) => [...prev, data]);
        if (!isConnected) setIsConnected(true);
      }
    );

    return () => {
      if (cleanup) cleanup();
    };
  }, []);

  const clearInsights = useCallback(() => {
    setInsights(null);
    setInsightsHistory([]);
  }, []);

  return {
    insights,
    insightsHistory,
    isConnected,
    clearInsights,
  };
}
