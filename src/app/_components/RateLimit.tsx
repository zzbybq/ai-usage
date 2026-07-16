import { Gauge, Timer } from "lucide-react";
import { fmtPct, fmtRelative } from "@/lib/format";
import type { UsageSnapshot } from "@/lib/types";

type Props = {
  limits: UsageSnapshot["rateLimits"];
  referenceTime?: string;
};

function Bar({ percent }: { percent?: number }) {
  const p = Math.max(0, Math.min(100, percent ?? 0));
  const color =
    p < 50 ? "from-emerald-400 to-emerald-500" :
    p < 80 ? "from-amber-300 to-amber-500" :
    "from-rose-400 to-rose-500";
  return (
    <div className="h-2 w-full bg-zinc-800/70 rounded-full overflow-hidden">
      <div
        className={`h-full bg-gradient-to-r ${color} rounded-full transition-[width] duration-700`}
        style={{ width: `${p}%` }}
      />
    </div>
  );
}

function windowLabel(minutes?: number): string {
  if (!minutes || minutes <= 0) return "Usage window";
  if (minutes % 10080 === 0) {
    const weeks = minutes / 10080;
    return weeks === 1 ? "7-day window" : `${weeks}-week window`;
  }
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return `${days}-day window`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours}-hour window`;
  }
  return `${minutes}-minute window`;
}

export function RateLimit({ limits, referenceTime }: Props) {
  const rows = limits.flatMap((limit) => limit.windows.map((window) => ({ limit, window }))).slice(0, 2);
  const latestObservedAt = limits
    .map((limit) => limit.observedAt)
    .sort((a, b) => b.localeCompare(a))[0];
  const observedMs = latestObservedAt ? new Date(latestObservedAt).getTime() : 0;
  const referenceMs = referenceTime ? new Date(referenceTime).getTime() : observedMs;
  const stale = observedMs > 0 && referenceMs - observedMs > 2 * 60 * 60 * 1000;
  const planType = limits.find((limit) => limit.planType)?.planType;

  if (rows.length === 0) {
    return (
      <div className="card p-5">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-zinc-400 font-medium">
          <Gauge size={14} /> Limits &amp; Quota
        </div>
        <div className="mt-4 text-sm text-zinc-500">No reliable limit signal yet.</div>
        <div className="mt-2 text-[11px] text-zinc-600">A fresh signal appears after an eligible tool reports usage.</div>
      </div>
    );
  }

  return (
    <div className="card p-5 self-start">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-zinc-400 font-medium">
          <Gauge size={14} /> Limits &amp; Quota
        </div>
        <div className="flex items-center gap-2">
          {stale && (
            <span className="text-[10px] font-medium uppercase tracking-wider text-amber-300">Stale</span>
          )}
          {planType && (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-violet-400/10 text-violet-300 ring-1 ring-inset ring-violet-400/30 uppercase tracking-wider">
              {planType}
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 space-y-4">
        {rows.map(({ limit, window }) => {
          const remaining = window.usedPercent === undefined ? undefined : Math.max(0, 100 - window.usedPercent);
          const name = limit.limitName || (limit.source === "codex" ? "Codex" : limit.source);
          return (
            <div key={`${limit.limitId}-${window.windowMinutes ?? "unknown"}`}>
              <div className="mb-1.5 flex items-end justify-between gap-3 text-xs text-zinc-400">
                <span>
                  <span className="text-zinc-300">{name}</span>
                  <span className="text-zinc-600"> · {windowLabel(window.windowMinutes)}</span>
                </span>
                <span className="num text-zinc-100 font-medium">{fmtPct(window.usedPercent ?? 0)} used</span>
              </div>
              <Bar percent={window.usedPercent} />
              <div className="mt-1.5 flex items-center justify-between gap-3 text-[11px] text-zinc-500 num">
                <span>{remaining === undefined ? "Remaining unavailable" : `${fmtPct(remaining)} remaining`}</span>
                {window.resetsAt && (
                  <span className="flex items-center gap-1"><Timer size={11} /> resets {fmtRelative(window.resetsAt)}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {latestObservedAt && (
        <div className="mt-4 border-t border-zinc-800/60 pt-3 text-[10px] text-zinc-600">
          Observed {fmtRelative(latestObservedAt)} from local session data
        </div>
      )}
    </div>
  );
}
