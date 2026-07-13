import type { ModelBreakdown, SourceId } from "@/lib/types";
import { fmtTokens, fmtCost } from "@/lib/format";
import { clsx } from "clsx";

const SOURCE_LABEL: Record<SourceId, { label: string; cls: string }> = {
  "claude-code": { label: "Claude", cls: "bg-[#d97757]/15 text-[#f4a583] ring-1 ring-inset ring-[#d97757]/30" },
  codex: { label: "Codex", cls: "bg-[#a78bfa]/15 text-[#c4b5fd] ring-1 ring-inset ring-[#a78bfa]/30" },
  hermes: { label: "Hermes", cls: "bg-[#38bdf8]/15 text-[#7dd3fc] ring-1 ring-inset ring-[#38bdf8]/30" },
};

export function ModelTable({ models }: { models: ModelBreakdown[] }) {
  const top = models.slice(0, 10);
  const maxTokens = Math.max(1, ...top.map((m) => m.tokens));

  if (top.length === 0) {
    return <div className="text-sm text-zinc-500 py-8 text-center">No usage in this range yet.</div>;
  }

  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full text-sm num">
        <thead>
          <tr className="text-[11px] uppercase tracking-[0.12em] text-zinc-500 text-left">
            <th className="font-medium pb-3 pr-4">Model</th>
            <th className="font-medium pb-3 pr-4">Source</th>
            <th className="font-medium pb-3 pr-4 text-right">Tokens</th>
            <th className="font-medium pb-3 pr-4 text-right">Cost</th>
            <th className="font-medium pb-3 pr-4 text-right">Sessions</th>
            <th className="font-medium pb-3 w-32">Share</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/60">
          {top.map((m) => {
            const pct = (m.tokens / maxTokens) * 100;
            const s = SOURCE_LABEL[m.source];
            return (
              <tr key={`${m.source}-${m.model}`} className="hover:bg-zinc-800/20 transition-colors">
                <td className="py-2.5 pr-4 font-mono text-[13px] text-zinc-200">{m.model}</td>
                <td className="py-2.5 pr-4">
                  <span className={clsx("inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium", s.cls)}>
                    {s.label}
                  </span>
                </td>
                <td className="py-2.5 pr-4 text-right text-zinc-100">{fmtTokens(m.tokens)}</td>
                <td className="py-2.5 pr-4 text-right text-zinc-100">{fmtCost(m.costUSD)}</td>
                <td className="py-2.5 pr-4 text-right text-zinc-400">{m.sessions}</td>
                <td className="py-2.5">
                  <div className="h-1.5 w-full bg-zinc-800/60 rounded-full overflow-hidden">
                    <div
                      className={clsx(
                        "h-full rounded-full",
                        m.source === "claude-code" ? "bg-gradient-to-r from-[#d97757] to-[#f0a378]" :
                        m.source === "hermes" ? "bg-gradient-to-r from-[#38bdf8] to-[#7dd3fc]" :
                        "bg-gradient-to-r from-[#a78bfa] to-[#c4b5fd]"
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
