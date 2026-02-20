import { useCallback, useEffect, useRef, useState } from "react";
import { getCached, setCache } from "./cache";

export interface UseCachedFetchOptions<T> {
  key: string;
  fetcher: () => Promise<T>;
  /** TTL for in-memory cache (default: 5 minutes). */
  ttlMs?: number;
  /** Background poll interval in ms (default: 0 = no polling). */
  pollIntervalMs?: number;
  enabled?: boolean;
}

/**
 * Lightweight cached fetch hook for reference/supporting data.
 *
 * Unlike useUnseenList, this has no unseen-item tracking, no localStorage
 * persistence, and no sort logic. It just fetches, caches in memory, and
 * optionally polls. The in-memory cache survives SPA route changes so
 * navigating between pages is instant when the cache is fresh.
 */
export function useCachedFetch<T>(options: UseCachedFetchOptions<T>) {
  const {
    key,
    fetcher,
    ttlMs = 5 * 60 * 1000,
    pollIntervalMs = 0,
    enabled = true,
  } = options;

  const cached = getCached<T>(key, ttlMs);
  const [data, setData] = useState<T | null>(cached);
  const [loading, setLoading] = useState(cached === null);
  const [error, setError] = useState<Error | null>(null);
  const inFlightRef = useRef(false);
  const initialCacheHit = useRef(cached !== null);

  const refresh = useCallback(async () => {
    if (!enabled || inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const result = await fetcher();
      setData(result);
      setCache(key, result);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
      inFlightRef.current = false;
    }
  }, [enabled, key, fetcher]);

  useEffect(() => {
    if (!enabled) return;
    if (!initialCacheHit.current) {
      refresh();
    }
    initialCacheHit.current = false;

    if (pollIntervalMs > 0) {
      const interval = setInterval(refresh, pollIntervalMs);
      return () => clearInterval(interval);
    }
  }, [enabled, refresh, pollIntervalMs]);

  return { data, loading, error, refresh };
}
