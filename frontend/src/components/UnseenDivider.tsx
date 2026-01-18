import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export const UnseenDivider = forwardRef<
  HTMLDivElement,
  { visible: boolean; label?: string }
>(({ visible, label = "Unseen" }, ref) => {
  return (
    <div
      ref={ref}
      className={cn(
        "flex items-center gap-3 text-xs uppercase tracking-wide text-bauhaus-red",
        visible ? "py-2" : "h-0 py-0 opacity-0 pointer-events-none"
      )}
      aria-hidden={!visible}
    >
      <span className="flex-1 border-t border-bauhaus-red" />
      <span>{label}</span>
      <span className="flex-1 border-t border-bauhaus-red" />
    </div>
  );
});

UnseenDivider.displayName = "UnseenDivider";
