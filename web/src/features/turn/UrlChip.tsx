import { cn } from "@/lib/utils";
import { isRelayUrl, turnScheme } from "./validation";

/** ICE URL as a monospace chip; the scheme is tinted (TURN — accent, STUN — neutral). */
export function UrlChip({ url, className }: { url: string; className?: string }) {
  const scheme = turnScheme(url);
  const rest = scheme ? url.slice(scheme.length) : url;
  const relay = isRelayUrl(url);
  return (
    <span
      title={url}
      className={cn(
        "inline-flex h-6 max-w-full items-center overflow-hidden rounded-sm border border-line bg-bg-elevated font-mono text-[11.5px]",
        className,
      )}
    >
      {scheme && (
        <span
          className={cn(
            "flex h-full shrink-0 items-center border-r border-line px-1.5",
            relay ? "bg-accent-soft text-accent" : "bg-surface-2 text-fg-muted",
          )}
        >
          {scheme}
        </span>
      )}
      <span className="truncate px-1.5 text-fg">{rest}</span>
    </span>
  );
}
