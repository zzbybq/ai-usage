"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Coins, Database, FlaskConical, History, Sparkles } from "lucide-react";
import { Header } from "./_components/Header";
import { StatCard } from "./_components/StatCard";
import { DailyChart } from "./_components/DailyChart";
import { TrendChart } from "./_components/TrendChart";
import { ModelTable } from "./_components/ModelTable";
import { RateLimit } from "./_components/RateLimit";
import { SourceSplit } from "./_components/SourceSplit";
import { DailyGoalPicker } from "./_components/DailyGoalPicker";
import { fmtTokens, fmtCost } from "@/lib/format";
import type { LiveUsageSnapshot, UsageSnapshot } from "@/lib/types";

export default function Page() {
  const [range, setRange] = useState<7 | 30 | 90>(30);
  const [metric, setMetric] = useState<"tokens" | "cost">("tokens");
  const [data, setData] = useState<UsageSnapshot | null>(null);
  const [live, setLive] = useState<LiveUsageSnapshot | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [liveLoading, setLiveLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const historyRequestInFlight = useRef(false);
  const liveRequestInFlight = useRef(false);

  const fetchHistory = useCallback(async (force = false) => {
    if (historyRequestInFlight.current) return;
    historyRequestInFlight.current = true;
    setHistoryLoading(true);
    try {
      const refresh = force ? "&refresh=1" : "";
      const res = await fetch(`/api/usage?days=${range}${refresh}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const snap = (await res.json()) as UsageSnapshot;
      setData(snap);
      setHistoryError(null);
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : String(e));
    } finally {
      historyRequestInFlight.current = false;
      setHistoryLoading(false);
    }
  }, [range]);

  const fetchLive = useCallback(async (force = false) => {
    if (liveRequestInFlight.current) return;
    liveRequestInFlight.current = true;
    setLiveLoading(true);
    try {
      const refresh = force ? "?refresh=1" : "";
      const res = await fetch(`/api/widget${refresh}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setLive((await res.json()) as LiveUsageSnapshot);
      setLiveError(null);
    } catch (e) {
      setLiveError(e instanceof Error ? e.message : String(e));
    } finally {
      liveRequestInFlight.current = false;
      setLiveLoading(false);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([fetchHistory(true), fetchLive(true)]);
  }, [fetchHistory, fetchLive]);

  useEffect(() => {
    // Historical charts and model summaries are intentionally less frequent.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchHistory();
    const id = setInterval(() => void fetchHistory(), 60_000);
    return () => clearInterval(id);
  }, [fetchHistory]);

  useEffect(() => {
    // The dashboard Today cards and Tauri orb share this same 15-second snapshot.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchLive();
    const id = setInterval(() => void fetchLive(), 15_000);
    return () => clearInterval(id);
  }, [fetchLive]);

  const daily = useMemo(() => data?.daily ?? [], [data]);
  const recent = useMemo(() => daily.slice(-range), [daily, range]);
  const current = live ?? data;
  const currentToday = current?.today;
  const currentSources = current?.sources ?? [];
  const currentRateLimits = current?.rateLimits ?? [];
  const todayCacheRead = currentToday?.cacheReadTokens ?? 0;
  const todayCacheWrite = currentToday?.cacheCreateTokens ?? 0;
  const todayTotal = currentToday?.totalTokens ?? 0;
  const todayCachePct = todayTotal > 0 ? (todayCacheRead / todayTotal) * 100 : 0;
  const loading = historyLoading || liveLoading;
  const error = liveError || historyError;

  return (
    <main className="relative mx-auto w-full max-w-[1400px] px-6 lg:px-10 py-8">
      <Header
        range={range}
        setRange={setRange}
        metric={metric}
        setMetric={setMetric}
        generatedAt={current?.generatedAt}
        loading={loading}
        onRefresh={() => void refreshAll()}
        sourceCount={currentSources.length}
        onSourcesChanged={refreshAll}
      />

      {error && (
        <div className="mt-6 card p-4 border-rose-400/40 text-sm text-rose-300">
          Failed to load: {error}
        </div>
      )}

      <section className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          accent="claude"
          label="Today · Tokens"
          icon={
            <DailyGoalPicker
              goal={current?.dailyGoal}
              currentTokens={todayTotal}
              onSaved={refreshAll}
            />
          }
          value={fmtTokens(todayTotal)}
          sub={
            <div className="num">
              <div className="grid grid-cols-3 divide-x divide-zinc-800/80">
                <div className="pr-2">
                  <span className="block text-[9px] uppercase tracking-[0.12em] text-zinc-600">Input</span>
                  <span className="mt-0.5 block text-[13px] font-medium text-zinc-300">
                    {fmtTokens(currentToday?.inputTokens ?? 0)}
                  </span>
                </div>
                <div className="px-2">
                  <span className="block text-[9px] uppercase tracking-[0.12em] text-zinc-600">Output</span>
                  <span className="mt-0.5 block text-[13px] font-medium text-zinc-300">
                    {fmtTokens(currentToday?.outputTokens ?? 0)}
                  </span>
                </div>
                <div className="pl-2">
                  <span className="block text-[9px] uppercase tracking-[0.12em] text-zinc-600">Cached</span>
                  <span className="mt-0.5 block text-[13px] font-medium text-zinc-300">
                    {fmtTokens(todayCacheRead)}
                  </span>
                </div>
              </div>
              <div className="mt-2 flex min-h-5 items-center gap-2">
                <span className="rounded-full border border-[#d97757]/25 bg-[#d97757]/8 px-2 py-0.5 text-[10px] text-[#f0a378]">
                  {todayCachePct.toFixed(1)}% reused
                </span>
                {todayCacheWrite > 0 && (
                  <span className="text-[10px] text-zinc-500">
                    Cache write {fmtTokens(todayCacheWrite)}
                  </span>
                )}
              </div>
            </div>
          }
        />
        <StatCard
          accent="emerald"
          label="Today · Cost"
          icon={<Coins size={16} />}
          value={fmtCost(currentToday?.costUSD ?? 0)}
          sub={
            <span className="num">
              {currentToday?.sessions ?? 0} session{(currentToday?.sessions ?? 0) === 1 ? "" : "s"} ·
              Avg ${((currentToday?.costUSD ?? 0) / Math.max(1, currentToday?.sessions ?? 1)).toFixed(2)}
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
          {currentToday && <SourceSplit today={currentToday} sources={currentSources} />}
        </div>
        <RateLimit limits={currentRateLimits} referenceTime={current?.generatedAt} />
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
          <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-xs text-zinc-400">
            {(data?.sources ?? []).map((source) => (
              <div key={source.id} className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ backgroundColor: source.accent }} />
                {source.label}
              </div>
            ))}
          </div>
        </div>
        <div className="relative">
          <DailyChart data={recent} metric={metric} sources={data?.sources ?? []} />
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
              Token usage by model · {currentToday?.date ?? ""}
            </h2>
          </div>
        </div>
        <ModelTable models={current?.todayModels ?? []} />
      </section>

      <footer className="mt-6 text-[11px] text-zinc-600 num">
        Reads selected sources from local usage stores. No conversation data leaves your machine.
      </footer>
    </main>
  );
}
