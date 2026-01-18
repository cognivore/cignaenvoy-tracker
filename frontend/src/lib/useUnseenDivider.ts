import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

interface UnseenDividerOptions {
  dividerRef: RefObject<HTMLElement>;
  containerRef?: RefObject<HTMLElement | null>;
  onSeen: () => void;
  active: boolean;
  deps: unknown[];
}

export function useUnseenDivider({
  dividerRef,
  containerRef,
  onSeen,
  active,
  deps,
}: UnseenDividerOptions) {
  const lastOffsetRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const divider = dividerRef.current;
    if (!divider) return;

    const container = containerRef?.current ?? null;
    const getOffset = () => {
      const dividerRect = divider.getBoundingClientRect();
      if (container) {
        const containerRect = container.getBoundingClientRect();
        return dividerRect.top - containerRect.top + container.scrollTop;
      }
      return dividerRect.top + window.scrollY;
    };

    const previous = lastOffsetRef.current;
    const next = getOffset();

    if (previous !== null) {
      const delta = next - previous;
      if (Math.abs(delta) > 0.5) {
        if (container) {
          container.scrollTop += delta;
        } else {
          window.scrollBy({ top: delta });
        }
      }
    }

    lastOffsetRef.current = getOffset();
  }, deps);

  useEffect(() => {
    if (!active) return;
    const divider = dividerRef.current;
    if (!divider) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onSeen();
        }
      },
      {
        root: containerRef?.current ?? null,
        threshold: 0.01,
      }
    );

    observer.observe(divider);
    return () => observer.disconnect();
  }, [active, containerRef, dividerRef, onSeen]);
}
