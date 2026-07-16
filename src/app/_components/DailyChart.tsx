"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DailyBucket, SourceMeta } from "@/lib/types";
import { fmtTokens, fmtCost, fmtShortDay } from "@/lib/format";

type Props = {
  data: DailyBucket[];
  metric: "tokens" | "cost";
  sources: SourceMeta[];
};

type TooltipPayload = { payload: DailyBucket };

export function DailyChart({ data, metric, sources }: Props) {
  const rows = data.map((d) => ({
    date: d.date,
    ...Object.fromEntries(sources.map((source) => [
      source.id,
      metric === "tokens" ? d.bySource[source.id].tokens : d.bySource[source.id].costUSD,
    ])),
    total: metric === "tokens" ? d.totalTokens : d.costUSD,
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
        <defs>
          {sources.map((source) => (
            <linearGradient key={source.id} id={`g-${source.id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={source.accentEnd} stopOpacity={1} />
              <stop offset="100%" stopColor={source.accent} stopOpacity={0.85} />
            </linearGradient>
          ))}
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
            const row = (payload[0] as unknown as TooltipPayload).payload as unknown as Record<string, string | number>;
            return (
              <div className="card !rounded-lg !border-zinc-700/70 px-3 py-2 text-xs num shadow-xl">
                <div className="text-zinc-300 mb-1.5 font-medium">{fmtShortDay(String(row.date))}</div>
                {sources.map((source, index) => (
                  <div key={source.id} className={`flex items-center gap-2 ${index > 0 ? "mt-1" : ""}`}>
                    <span className="size-2 rounded-full" style={{ backgroundColor: source.accent }} />
                    {source.shortLabel}
                    <span className="ml-auto text-zinc-100">{metric === "tokens" ? fmtTokens(Number(row[source.id])) : fmtCost(Number(row[source.id]))}</span>
                  </div>
                ))}
                <div className="mt-1.5 pt-1.5 border-t border-zinc-700/50 flex items-center gap-2 text-zinc-300">Total <span className="ml-auto text-zinc-50 font-medium">{metric === "tokens" ? fmtTokens(Number(row.total)) : fmtCost(Number(row.total))}</span></div>
              </div>
            );
          }}
        />
        {sources.map((source, index) => (
          <Bar
            key={source.id}
            dataKey={source.id}
            stackId="s"
            fill={`url(#g-${source.id})`}
            radius={index === sources.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
