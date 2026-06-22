"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DailyBucket } from "@/lib/types";
import { fmtTokens, fmtCost, fmtShortDay } from "@/lib/format";

type Props = {
  data: DailyBucket[];
  metric: "tokens" | "cost";
};

type TooltipPayload = { payload: DailyBucket };

export function DailyChart({ data, metric }: Props) {
  const rows = data.map((d) => ({
    date: d.date,
    claude: metric === "tokens" ? d.bySource["claude-code"].tokens : d.bySource["claude-code"].costUSD,
    codex: metric === "tokens" ? d.bySource.codex.tokens : d.bySource.codex.costUSD,
    total: metric === "tokens" ? d.totalTokens : d.costUSD,
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
        <defs>
          <linearGradient id="g-claude" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fbbf7f" stopOpacity={1} />
            <stop offset="100%" stopColor="#d97757" stopOpacity={0.85} />
          </linearGradient>
          <linearGradient id="g-codex" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#d8caff" stopOpacity={1} />
            <stop offset="100%" stopColor="#9b7bf2" stopOpacity={0.85} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="rgba(63,63,70,0.35)" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={fmtShortDay}
          tick={{ fill: "#a1a1aa", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
          minTickGap={32}
        />
        <YAxis
          tickFormatter={(v) => (metric === "tokens" ? fmtTokens(v) : fmtCost(v))}
          tick={{ fill: "#a1a1aa", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={56}
        />
        <Tooltip
          cursor={{ fill: "rgba(161,161,170,0.06)" }}
          content={({ active, payload }) => {
            if (!active || !payload || !payload.length) return null;
            const row = (payload[0] as unknown as TooltipPayload).payload as unknown as {
              date: string; claude: number; codex: number; total: number;
            };
            return (
              <div className="card !rounded-lg !border-zinc-700/70 px-3 py-2 text-xs num shadow-xl">
                <div className="text-zinc-300 mb-1.5 font-medium">{fmtShortDay(row.date)}</div>
                <div className="flex items-center gap-2"><span className="size-2 rounded-full bg-[#d97757]" />Claude <span className="ml-auto text-zinc-100">{metric === "tokens" ? fmtTokens(row.claude) : fmtCost(row.claude)}</span></div>
                <div className="flex items-center gap-2 mt-1"><span className="size-2 rounded-full bg-[#a78bfa]" />Codex <span className="ml-auto text-zinc-100">{metric === "tokens" ? fmtTokens(row.codex) : fmtCost(row.codex)}</span></div>
                <div className="mt-1.5 pt-1.5 border-t border-zinc-700/50 flex items-center gap-2 text-zinc-300">Total <span className="ml-auto text-zinc-50 font-medium">{metric === "tokens" ? fmtTokens(row.total) : fmtCost(row.total)}</span></div>
              </div>
            );
          }}
        />
        <Bar dataKey="claude" stackId="s" fill="url(#g-claude)" radius={[0, 0, 0, 0]} />
        <Bar dataKey="codex" stackId="s" fill="url(#g-codex)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
