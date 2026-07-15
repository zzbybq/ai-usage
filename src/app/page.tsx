"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { Coins, Database, FlaskConical, History, Sparkles } from "lucide-react";
import { Header } from "./_components/Header";
import { StatCard } from "./_components/StatCard";
import { DailyChart } from "./_components/DailyChart";
import { TrendChart } from "./_components/TrendChart";
import { ModelTable } from "./_components/ModelTable";
import { RateLimit } from "./_components/RateLimit";
import { SourceSplit } from "./_components/SourceSplit";
import { fmtTokens, fmtCost } from "@/lib/format";
import type { UsageSnapshot } from "@/lib/types";

export default function Page() {
  const [range, setRange] = useState<7 | 30 | 90>(30);
  const [metric, setMetric] = useState<"tokens" | "cost">("tokens");
  const [data, setData] = useState<UsageSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/usage?days=${range}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const snap = (await res.json()) as UsageSnapshot;
      setData(snap);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    // Initial synchronization with the local usage API.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData();
    const id = setInterval(fetchData, 15_000);
    return () => clearInterval(id);
  }, [fetchData]);

  const daily = useMemo(() => data?.daily ?? [], [data]);
  const recent = useMemo(() => daily.slice(-range), [daily, range]);
  const todayCacheRead = data?.today.cacheReadTokens ?? 0;
  const todayCacheWrite = data?.today.cacheCreateTokens ?? 0;
  const todayCache = todayCacheRead + todayCacheWrite;
  const todayTotal = data?.today.totalTokens ?? 0;
  const todayCachePct = todayTotal > 0 ? (todayCache / todayTotal) * 100 : 0;

  return (
    <main className="relative mx-auto w-full max-w-[1400px] px-6 lg:px-10 py-8">
      <Header
        range={range}
        setRange={setRange}
        metric={metric}
        setMetric={setMetric}
        generatedAt={data?.generatedAt}
        loading={loading}
        onRefresh={fetchData}
      />

      {error && (
        <div className="mt-6 card p-4 border-rose-400/40 text-sm text-rose-300">
          Failed to load: {error}
        </div>
      )}

      <section className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          accent="claude"
          label="Today · Total Tokens (incl. cache)"
          icon={<Sparkles size={16} />}
          value={fmtTokens(todayTotal)}
          sub={
            <span className="num">
              Non-cache in {fmtTokens(data?.today.inputTokens ?? 0)} ·
              Cache read {fmtTokens(todayCacheRead)} ·
              Cache write {fmtTokens(todayCacheWrite)} ·
              Out {fmtTokens(data?.today.outputTokens ?? 0)} ·
              Cache {todayCachePct.toFixed(1)}%
            </span>
          }
        />
        <StatCard
          accent="emerald"
          label="Today · Cost"
          icon={<Coins size={16} />}
          value={fmtCost(data?.today.costUSD ?? 0)}
          sub={
            <span className="num">
              {data?.today.sessions ?? 0} session{(data?.today.sessions ?? 0) === 1 ? "" : "s"} ·
              avg {fmtCost((data?.today.costUSD ?? 0) / Math.max(1, data?.today.sessions ?? 1))}/session
            </span>
          }
        />
        <StatCard
          accent="violet"
          label={`Last ${range}d · Tokens`}
          icon={<History size={16} />}
          value={fmtTokens(recent.reduce((s, d) => s + d.totalTokens, 0))}
          sub={<TrendChart data={recent} metric="tokens" />}
        />
        <StatCard
          accent="amber"
          label={`Last ${range}d · Cost`}
          icon={<FlaskConical size={16} />}
          value={fmtCost(recent.reduce((s, d) => s + d.costUSD, 0))}
          sub={<TrendChart data={recent} metric="cost" />}
        />
      </section>

      <section className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          {data && <SourceSplit today={data.today} />}
        </div>
        <RateLimit
          primaryUsedPercent={data?.rateLimit?.primaryUsedPercent}
          primaryResetsAt={data?.rateLimit?.primaryResetsAt}
          secondaryUsedPercent={data?.rateLimit?.secondaryUsedPercent}
          secondaryResetsAt={data?.rateLimit?.secondaryResetsAt}
          planType={data?.rateLimit?.planType}
        />
      </section>

      <section className="mt-4 card p-5 relative overflow-hidden">
        <div className="grid-noise" />
        <div className="relative flex items-end justify-between gap-3 mb-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.14em] text-zinc-400 font-medium">
              Daily {metric === "tokens" ? "Tokens" : "Cost"}
            </div>
            <h2 className="mt-1 text-base font-semibold text-zinc-100 tracking-tight">
              Last {range} days · stacked by source
            </h2>
          </div>
          <div className="flex items-center gap-4 text-xs text-zinc-400">
            <div className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-[#d97757]" />Claude Code</div>
            <div className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-[#a78bfa]" />Codex CLI</div>
          </div>
        </div>
        <div className="relative">
          <DailyChart data={recent} metric={metric} />
        </div>
      </section>

      <section className="mt-4 card p-5">
        <div className="flex items-end justify-between mb-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.14em] text-zinc-400 font-medium">
              <Database size={12} className="inline mr-1 -mt-0.5" /> Top Models
            </div>
            <h2 className="mt-1 text-base font-semibold text-zinc-100 tracking-tight">
              By tokens · last {range} days
            </h2>
          </div>
          {data && data.warnings.length > 0 && (
            <div className="text-[11px] text-amber-300/80">
              {data.warnings.length} warning{data.warnings.length === 1 ? "" : "s"}
            </div>
          )}
        </div>
        <ModelTable models={data?.models ?? []} />
      </section>

      <section className="mt-4 card p-5">
        <div className="flex items-end justify-between mb-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.14em] text-zinc-400 font-medium">
              <Sparkles size={12} className="inline mr-1 -mt-0.5" /> Today · Models
            </div>
            <h2 className="mt-1 text-base font-semibold text-zinc-100 tracking-tight">
              Token usage by model · {data?.today.date ?? ""}
            </h2>
          </div>
        </div>
        <ModelTable models={data?.todayModels ?? []} />
      </section>

      <footer className="mt-6 text-[11px] text-zinc-600 num">
        Reads <span className="font-mono text-zinc-500">~/.claude/projects</span> and <span className="font-mono text-zinc-500">~/.codex/sessions</span> directly. No data leaves your machine.
      </footer>
    </main>
  );
}
