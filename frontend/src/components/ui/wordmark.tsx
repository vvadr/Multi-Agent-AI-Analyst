import { cn } from "@/lib/cn";
import { SPECTRUM } from "@/lib/stages";

/**
 * The mark: four rising bars in the stage spectrum — the pipeline, compressed
 * to a glyph. It is the same four colours in the same order as the trace, so
 * the logo teaches the mapping before the reader has seen a run.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span aria-hidden className="flex h-5 items-end gap-[3px]">
        {SPECTRUM.map((color, index) => (
          <span
            key={color}
            className="w-[3px] rounded-full"
            style={{
              background: color,
              height: `${9 + index * 3}px`,
              boxShadow: `0 0 8px ${color}`,
            }}
          />
        ))}
      </span>
      <span className="font-data text-ink text-[11px] font-medium tracking-[0.2em]">
        ANALYST
      </span>
    </div>
  );
}
