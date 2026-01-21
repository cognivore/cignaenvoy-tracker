import { useCallback, useEffect, useRef, useState } from "react";
import { getCached, setCache } from "./cache";

export interface UseUnseenListOptions<T> {
  fetcher: () => Promise<T[]>;
  getId?: (item: T) => string;
  sortFn?: (a: T, b: T) => number;
  pollIntervalMs?: number;
  enabled?: boolean;
  /** Unique key for localStorage persistence. If provided, seen IDs and cached items persist across refreshes. */
  cacheKey?: string;
  /** TTL for in-memory cache (default: 5 minutes). Set to 0 to disable memory caching. */
  cacheTtlMs?: number;
}

function loadFromStorage<V>(key: string): V | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as V) : null;
  } catch {
    return null;
  }
}

function saveToStorage<V>(key: string, value: V): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota exceeded or private mode - ignore
  }
}

export function useUnseenList<T extends { id: string }>(
  options: UseUnseenListOptions<T>
) {
  const {
    fetcher,
    getId = (item) => item.id,
    sortFn,
    pollIntervalMs = 30000,
    enabled = true,
    cacheKey,
    cacheTtlMs = 5 * 60 * 1000, // 5 minutes default
  } = options;

  const seenStorageKey = cacheKey ? `unseen-list-seen:${cacheKey}` : null;
  const itemsStorageKey = cacheKey ? `unseen-list-items:${cacheKey}` : null;
  const memoryCacheKey = cacheKey ? `unseen-list:${cacheKey}` : null;

  // Check for fresh in-memory cache first (instant, no flicker)
  const memoryCached = memoryCacheKey && cacheTtlMs > 0
    ? getCached<T[]>(memoryCacheKey, cacheTtlMs)
    : null;

  // Initialize from memory cache > localStorage > empty
  const [items, setItems] = useState<T[]>(() => {
    if (memoryCached) return memoryCached;
    if (!itemsStorageKey) return [];
    return loadFromStorage<T[]>(itemsStorageKey) ?? [];
  });

  // Check if we have cached items - if so, show them immediately (no spinner)
  const hasCachedItems = memoryCached !== null || (itemsStorageKey
    ? (loadFromStorage<T[]>(itemsStorageKey)?.length ?? 0) > 0
    : false);

  // Skip initial fetch if we have fresh memory cache
  const hasMemoryCacheRef = useRef(memoryCached !== null);

  const [loading, setLoading] = useState(!hasCachedItems);
  const [error, setError] = useState<Error | null>(null);
  const [unseenIds, setUnseenIds] = useState<Set<string>>(new Set());

  // Track whether we've completed at least one fetch (separate from "seen" cache)
  // If we have cached items, consider fetch already done (we're showing data)
  const fetchedOnceRef = useRef(hasCachedItems);
  const inFlightRef = useRef(false);
  const knownIdsRef = useRef<Set<string>>(
    seenStorageKey
      ? new Set(loadFromStorage<string[]>(seenStorageKey) ?? [])
      : new Set()
  );
  // Consider initialized if we have seen IDs cached
  const initializedRef = useRef(knownIdsRef.current.size > 0);

  const sortItems = useCallback(
    (list: T[]) => (sortFn ? [...list].sort(sortFn) : list),
    [sortFn]
  );

  const mergeFetched = useCallback(
    (fetched: T[]) => {
      const sorted = sortItems(fetched);
      setItems(sorted);

      // Persist items to memory cache and localStorage
      if (memoryCacheKey && cacheTtlMs > 0) {
        setCache(memoryCacheKey, sorted);
      }
      if (itemsStorageKey) {
        saveToStorage(itemsStorageKey, sorted);
      }

      setUnseenIds((prev) => {
        const nextIds = new Set(sorted.map(getId));

        if (!initializedRef.current) {
          knownIdsRef.current = nextIds;
          initializedRef.current = true;
          // Persist known IDs
          if (seenStorageKey) {
            saveToStorage(seenStorageKey, Array.from(nextIds));
          }
          return new Set();
        }

        const nextUnseen = new Set(prev);
        for (const id of nextIds) {
          if (!knownIdsRef.current.has(id)) {
            nextUnseen.add(id);
          }
        }

        for (const id of Array.from(nextUnseen)) {
          if (!nextIds.has(id)) {
            nextUnseen.delete(id);
          }
        }

        knownIdsRef.current = nextIds;
        // Persist known IDs
        if (seenStorageKey) {
          saveToStorage(seenStorageKey, Array.from(nextIds));
        }
        return nextUnseen;
      });
    },
    [getId, sortItems, itemsStorageKey, seenStorageKey, memoryCacheKey, cacheTtlMs]
  );

  const refresh = useCallback(async () => {
    if (!enabled || inFlightRef.current) return;
    inFlightRef.current = true;

    try {
      const data = await fetcher();
      mergeFetched(data);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      // Always clear loading after first fetch completes
      if (!fetchedOnceRef.current) {
        fetchedOnceRef.current = true;
        setLoading(false);
      }
      inFlightRef.current = false;
    }
  }, [enabled, fetcher, mergeFetched]);

  const applyLocalUpdate = useCallback(
    (updater: (current: T[]) => T[]) => {
      setItems((prev) => {
        const next = sortItems(updater(prev));
        const nextIds = new Set(next.map(getId));
        knownIdsRef.current = nextIds;
        // Persist to memory cache, localStorage
        if (memoryCacheKey && cacheTtlMs > 0) {
          setCache(memoryCacheKey, next);
        }
        if (seenStorageKey) {
          saveToStorage(seenStorageKey, Array.from(nextIds));
        }
        if (itemsStorageKey) {
          saveToStorage(itemsStorageKey, next);
        }
        setUnseenIds((currentUnseen) => {
          const filtered = new Set(
            Array.from(currentUnseen).filter((id) => nextIds.has(id))
          );
          return filtered;
        });
        return next;
      });
    },
    [getId, sortItems, seenStorageKey, itemsStorageKey, memoryCacheKey, cacheTtlMs]
  );

  const upsertItem = useCallback(
    (item: T) =>
      applyLocalUpdate((current) => {
        const id = getId(item);
        const index = current.findIndex((entry) => getId(entry) === id);
        if (index === -1) return [item, ...current];
        return current.map((entry) => (getId(entry) === id ? item : entry));
      }),
    [applyLocalUpdate, getId]
  );

  const removeItem = useCallback(
    (id: string) =>
      applyLocalUpdate((current) =>
        current.filter((entry) => getId(entry) !== id)
      ),
    [applyLocalUpdate, getId]
  );

  const markAllSeen = useCallback(() => {
    setUnseenIds(new Set());
    // When marking all seen, persist current known IDs
    if (seenStorageKey) {
      saveToStorage(seenStorageKey, Array.from(knownIdsRef.current));
    }
  }, [seenStorageKey]);

  useEffect(() => {
    if (!enabled) return;
    // Skip initial fetch if we have fresh memory cache (instant navigation)
    if (!hasMemoryCacheRef.current) {
      refresh();
    }
    // Clear the flag so subsequent mounts will fetch
    hasMemoryCacheRef.current = false;
    if (pollIntervalMs <= 0) return;
    const interval = setInterval(refresh, pollIntervalMs);
    return () => clearInterval(interval);
  }, [enabled, pollIntervalMs, refresh]);

  return {
    items,
    loading,
    error,
    unseenIds,
    hasUnseen: unseenIds.size > 0,
    refresh,
    markAllSeen,
    applyLocalUpdate,
    upsertItem,
    removeItem,
  };
}
