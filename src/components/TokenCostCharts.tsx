"use client";

import { useState, useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

type Bucket = "hour" | "day" | "week";

interface TimeSeriesPoint {
  timestamp: number;
  label: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  calls: number;
}

interface BreakdownItem {
  app?: string;
  model?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  calls: number;
}

interface AggregatesData {
  timeSeries: TimeSeriesPoint[];
  appBreakdown: BreakdownItem[];
  modelBreakdown: BreakdownItem[];
  priceTable: Record<string, { input: number; output: number }>;
  defaultPrice: { input: number; output: number };
  /** true when the window held more records than one query reads; the oldest were left out */
  truncated?: boolean;
}

const BUCKET_NAMES: Record<Bucket, string> = { hour: "Hourly", day: "Daily", week: "Weekly" };
const formatPrice = (n: number) => (n < 1 ? n.toFixed(3) : n.toFixed(2));

interface TokenCostChartsProps {
  password: string;
  appName?: string;
  model?: string;
  bucket?: Bucket;
  startTime?: number;
  endTime?: number;
  onClearFilters?: () => void;
}

const COMPACT = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const TOKEN_COLORS = { input: "#3b82f6", output: "#60a5fa", cost: "#22c55e" } as const;

interface Segment {
  value: number;
  color: string;
  label: string;
}

const CHART_HEIGHT = 300;
const MARGIN = { left: 64, right: 16, top: 12, bottom: 36 };

/** A bar chart with room around the plot for axis labels. Each bar is a stack of segments. */
function BarChart({
  points,
  max,
  segments,
  formatTick,
  ariaLabel,
}: {
  points: TimeSeriesPoint[];
  max: number;
  segments: (p: TimeSeriesPoint) => Segment[];
  formatTick: (n: number) => string;
  ariaLabel: string;
}) {
  const n = Math.max(points.length, 1);
  const barWidth = Math.max(24, Math.min(60, 800 / n));
  const step = barWidth + 8;
  const width = Math.max(400, MARGIN.left + MARGIN.right + n * step);
  const plotHeight = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;
  const baseline = MARGIN.top + plotHeight;
  const labelEvery = Math.max(1, Math.ceil(56 / step)); // keep date labels from overlapping
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="overflow-x-auto" role="img" aria-label={ariaLabel}>
      <svg width={width} height={CHART_HEIGHT} viewBox={`0 0 ${width} ${CHART_HEIGHT}`}>
        <g stroke="white" strokeOpacity="0.08" strokeWidth="1">
          {ticks.map((frac) => {
            const y = baseline - frac * plotHeight;
            return <line key={frac} x1={MARGIN.left} y1={y} x2={width - MARGIN.right} y2={y} />;
          })}
        </g>
        <g fontSize="11" fill="white" fillOpacity="0.55" textAnchor="end">
          {ticks.map((frac) => (
            <text key={frac} x={MARGIN.left - 8} y={baseline - frac * plotHeight} dominantBaseline="middle">
              {formatTick(max * frac)}
            </text>
          ))}
        </g>
        <g>
          {points.map((point, i) => {
            const x = MARGIN.left + i * step + 4;
            let top = baseline;
            return (
              <g key={point.timestamp}>
                {segments(point).map((seg) => {
                  const h = max > 0 ? (seg.value / max) * plotHeight : 0;
                  if (h <= 0) return null;
                  top -= h;
                  return (
                    <rect key={seg.label} x={x} y={top} width={barWidth} height={h} fill={seg.color} rx={2}>
                      <title>{`${point.label}: ${seg.label}`}</title>
                    </rect>
                  );
                })}
                {i % labelEvery === 0 && (
                  <text x={x + barWidth / 2} y={baseline + 16} textAnchor="middle" fontSize="11" fill="white" fillOpacity="0.65">
                    {point.label}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

export function TokenCostCharts({
  password,
  appName,
  model,
  bucket = "day",
  startTime,
  endTime,
  onClearFilters,
}: TokenCostChartsProps) {
  const [viewMode, setViewMode] = useState<"chart" | "table">("chart");
  const [selectedBucket, setSelectedBucket] = useState<Bucket>(bucket);

  const aggregates: AggregatesData | undefined = useQuery(api.usage.getTokenCostAggregates, {
    dashboardPassword: password,
    appName: appName as any,
    model,
    bucket: selectedBucket,
    startTime,
    endTime,
  });

  // All hooks must run on every render, before any early return below (rules of hooks):
  // while the data is loading `aggregates` is undefined, and these still have to be called.
  const series = aggregates?.timeSeries;
  const maxTokens = useMemo(() => Math.max(...(series ?? []).map((p) => p.totalTokens), 1), [series]);
  const maxCost = useMemo(() => Math.max(...(series ?? []).map((p) => p.cost), 0.001), [series]);

  if (aggregates === undefined) {
    return (
      <div className="space-y-4" role="status" aria-live="polite">
        <div className="h-64 w-full animate-pulse bg-white/5 rounded-lg" />
        <div className="h-64 w-full animate-pulse bg-white/5 rounded-lg" />
        <div className="h-64 w-full animate-pulse bg-white/5 rounded-lg" />
      </div>
    );
  }

  const { timeSeries, appBreakdown, modelBreakdown, priceTable, defaultPrice } = aggregates;

  const hasData = timeSeries.length > 0 || appBreakdown.length > 0 || modelBreakdown.length > 0;

  if (!hasData) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p className="text-lg">No usage data for the selected filters.</p>
        <p className="text-sm mt-1">Adjust the date range, app, or model filters to see data.</p>
        {onClearFilters && (
          <button
            onClick={onClearFilters}
            className="mt-4 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
          >
            Clear Filters
          </button>
        )}
      </div>
    );
  }

  const bucketName = BUCKET_NAMES[selectedBucket];

  const formatCost = (cost: number) => `$${cost.toFixed(cost < 0.01 ? 4 : 2)}`;
  const formatTokens = (tokens: number) => tokens.toLocaleString();


  return (
    <div className="space-y-8">
      {/* View Toggle */}
      <div className="flex items-center gap-4" role="group" aria-label="View mode">
        <label className="text-sm text-gray-400">View:</label>
        <div className="flex border border-white/10 rounded-lg overflow-hidden" role="radiogroup">
          <button
            role="radio"
            aria-checked={viewMode === "chart"}
            onClick={() => setViewMode("chart")}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              viewMode === "chart" ? "bg-white/10 text-white" : "text-gray-400 hover:text-white"
            }`}
          >
            Chart
          </button>
          <button
            role="radio"
            aria-checked={viewMode === "table"}
            onClick={() => setViewMode("table")}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              viewMode === "table" ? "bg-white/10 text-white" : "text-gray-400 hover:text-white"
            }`}
          >
            Table
          </button>
        </div>

        <label className="text-sm text-gray-400 ml-4">Bucket:</label>
        <select
          value={selectedBucket}
          onChange={(e) => setSelectedBucket(e.target.value as Bucket)}
          className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-white/20"
          aria-label="Time bucket"
        >
          <option value="hour">Hour</option>
          <option value="day">Day</option>
          <option value="week">Week</option>
        </select>
      </div>

      {aggregates.truncated && (
        <p className="text-xs text-yellow-400" role="note">
          This window has more records than one query reads, so the oldest are left out. Narrow the date range for exact totals.
        </p>
      )}

      {/* Price Table Assumption Notice */}
      <details className="group border border-white/10 rounded-lg overflow-hidden">
        <summary className="flex items-center justify-between p-4 cursor-pointer list-none">
          <span className="text-sm text-gray-300 font-medium">Cost estimation assumptions (click to expand)</span>
          <span className="text-gray-500 transition-transform group-open:rotate-180">▼</span>
        </summary>
        <div className="px-4 pb-4 space-y-2 text-xs text-gray-400 border-t border-white/5">
          <p>Costs are estimated using per-model pricing (USD per 1M tokens). Prices are approximate and may not reflect your actual contract rates.</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 text-xs">
            {Object.entries(priceTable).map(([model, prices]) => (
              <div key={model} className="bg-white/5 p-2 rounded">
                <div className="font-mono text-white">{model}</div>
                <div className="text-gray-500">In: ${formatPrice(prices.input)} / Out: ${formatPrice(prices.output)} per 1M</div>
              </div>
            ))}
            <div className="bg-white/5 p-2 rounded">
              <div className="font-mono text-white">Default (unknown models)</div>
              <div className="text-gray-500">In: ${formatPrice(defaultPrice.input)} / Out: ${formatPrice(defaultPrice.output)} per 1M</div>
            </div>
          </div>
        </div>
      </details>

      {viewMode === "chart" ? (
        <div className="space-y-8">
          {/* Stacked Bar Chart: Input vs Output Tokens Over Time */}
          <section aria-labelledby="tokens-chart-title" className="space-y-4">
            <h3 id="tokens-chart-title" className="text-lg font-medium flex items-center gap-2">
              Input vs Output Tokens Over Time
              <span className="text-xs text-gray-500 font-normal">(stacked bars, {bucketName.toLowerCase()} buckets)</span>
            </h3>
            <div className="flex items-center gap-4 text-xs text-gray-400">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-sm" style={{ background: TOKEN_COLORS.input }} /> Input tokens
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-sm" style={{ background: TOKEN_COLORS.output }} /> Output tokens
              </span>
            </div>
            <BarChart
              points={timeSeries}
              max={maxTokens}
              formatTick={(n) => COMPACT.format(n)}
              ariaLabel="Stacked bar chart showing input and output tokens over time"
              segments={(p) => [
                { value: p.inputTokens, color: TOKEN_COLORS.input, label: `Input ${formatTokens(p.inputTokens)}` },
                { value: p.outputTokens, color: TOKEN_COLORS.output, label: `Output ${formatTokens(p.outputTokens)}` },
              ]}
            />

            {/* Chart data table for accessibility */}
            <details className="border border-white/10 rounded-lg overflow-hidden">
              <summary className="p-3 cursor-pointer text-sm text-gray-400 hover:text-white list-none flex items-center gap-2">
                <span>View as accessible data table</span>
                <span className="ml-auto text-gray-500">▼</span>
              </summary>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" role="table">
                  <thead>
                    <tr className="text-left border-b border-white/10 text-gray-400">
                      <th className="py-2 px-3" scope="col">Period</th>
                      <th className="py-2 px-3" scope="col">Input Tokens</th>
                      <th className="py-2 px-3" scope="col">Output Tokens</th>
                      <th className="py-2 px-3" scope="col">Total Tokens</th>
                      <th className="py-2 px-3" scope="col">Est. Cost</th>
                      <th className="py-2 px-3" scope="col">Calls</th>
                    </tr>
                  </thead>
                  <tbody>
                    {timeSeries.map((point) => (
                      <tr key={point.timestamp} className="border-b border-white/5">
                        <td className="py-2 px-3">{point.label}</td>
                        <td className="py-2 px-3 font-mono">{formatTokens(point.inputTokens)}</td>
                        <td className="py-2 px-3 font-mono">{formatTokens(point.outputTokens)}</td>
                        <td className="py-2 px-3 font-mono">{formatTokens(point.totalTokens)}</td>
                        <td className="py-2 px-3 font-mono">{formatCost(point.cost)}</td>
                        <td className="py-2 px-3 font-mono">{point.calls}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </section>

          {/* Cost Over Time Chart */}
          <section aria-labelledby="cost-chart-title" className="space-y-4">
            <h3 id="cost-chart-title" className="text-lg font-medium flex items-center gap-2">
              Estimated Cost Over Time
              <span className="text-xs text-gray-500 font-normal">({bucketName.toLowerCase()} buckets)</span>
            </h3>
            <BarChart
              points={timeSeries}
              max={maxCost}
              formatTick={formatCost}
              ariaLabel="Bar chart showing estimated cost over time"
              segments={(p) => [{ value: p.cost, color: TOKEN_COLORS.cost, label: `Est. cost ${formatCost(p.cost)}` }]}
            />

            <details className="border border-white/10 rounded-lg overflow-hidden">
              <summary className="p-3 cursor-pointer text-sm text-gray-400 hover:text-white list-none flex items-center gap-2">
                <span>View as accessible data table</span>
                <span className="ml-auto text-gray-500">▼</span>
              </summary>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" role="table">
                  <thead>
                    <tr className="text-left border-b border-white/10 text-gray-400">
                      <th className="py-2 px-3" scope="col">Period</th>
                      <th className="py-2 px-3" scope="col">Est. Cost</th>
                      <th className="py-2 px-3" scope="col">Total Tokens</th>
                      <th className="py-2 px-3" scope="col">Calls</th>
                    </tr>
                  </thead>
                  <tbody>
                    {timeSeries.map((point) => (
                      <tr key={point.timestamp} className="border-b border-white/5">
                        <td className="py-2 px-3">{point.label}</td>
                        <td className="py-2 px-3 font-mono">{formatCost(point.cost)}</td>
                        <td className="py-2 px-3 font-mono">{formatTokens(point.totalTokens)}</td>
                        <td className="py-2 px-3 font-mono">{point.calls}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </section>

          {/* Cost Breakdown by App */}
          {appBreakdown.length > 0 && (
            <section aria-labelledby="app-breakdown-title" className="space-y-4">
              <h3 id="app-breakdown-title" className="text-lg font-medium">Cost Breakdown by App</h3>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {appBreakdown.map((item) => (
                  <article
                    key={item.app}
                    className="rounded-lg border border-white/10 p-4 bg-white/5"
                    role="region"
                    aria-label={`${item.app} cost breakdown`}
                  >
                    <h4 className="font-medium text-white mb-2 truncate">{item.app}</h4>
                    <dl className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <dt className="text-gray-400">Est. Cost</dt>
                        <dd className="font-mono text-white font-medium">{formatCost(item.cost)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-gray-400">Input Tokens</dt>
                        <dd className="font-mono text-blue-300">{formatTokens(item.inputTokens)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-gray-400">Output Tokens</dt>
                        <dd className="font-mono text-blue-300">{formatTokens(item.outputTokens)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-gray-400">Total Tokens</dt>
                        <dd className="font-mono">{formatTokens(item.totalTokens)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-gray-400">Calls</dt>
                        <dd className="font-mono">{item.calls.toLocaleString()}</dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </div>

              <details className="border border-white/10 rounded-lg overflow-hidden">
                <summary className="p-3 cursor-pointer text-sm text-gray-400 hover:text-white list-none flex items-center gap-2">
                  <span>View as accessible data table</span>
                  <span className="ml-auto text-gray-500">▼</span>
                </summary>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" role="table">
                    <thead>
                      <tr className="text-left border-b border-white/10 text-gray-400">
                        <th className="py-2 px-3" scope="col">App</th>
                        <th className="py-2 px-3" scope="col">Est. Cost</th>
                        <th className="py-2 px-3" scope="col">Input Tokens</th>
                        <th className="py-2 px-3" scope="col">Output Tokens</th>
                        <th className="py-2 px-3" scope="col">Total Tokens</th>
                        <th className="py-2 px-3" scope="col">Calls</th>
                      </tr>
                    </thead>
                    <tbody>
                      {appBreakdown.map((item) => (
                        <tr key={item.app} className="border-b border-white/5">
                          <td className="py-2 px-3 font-medium">{item.app}</td>
                          <td className="py-2 px-3 font-mono">{formatCost(item.cost)}</td>
                          <td className="py-2 px-3 font-mono">{formatTokens(item.inputTokens)}</td>
                          <td className="py-2 px-3 font-mono">{formatTokens(item.outputTokens)}</td>
                          <td className="py-2 px-3 font-mono">{formatTokens(item.totalTokens)}</td>
                          <td className="py-2 px-3 font-mono">{item.calls.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </section>
          )}

          {/* Cost Breakdown by Model */}
          {modelBreakdown.length > 0 && (
            <section aria-labelledby="model-breakdown-title" className="space-y-4">
              <h3 id="model-breakdown-title" className="text-lg font-medium">Cost Breakdown by Model (Top 5 + Other)</h3>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {modelBreakdown.map((item) => (
                  <article
                    key={item.model}
                    className="rounded-lg border border-white/10 p-4 bg-white/5"
                    role="region"
                    aria-label={`${item.model} cost breakdown`}
                  >
                    <h4 className="font-medium text-white mb-2 truncate">{item.model}</h4>
                    <dl className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <dt className="text-gray-400">Est. Cost</dt>
                        <dd className="font-mono text-white font-medium">{formatCost(item.cost)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-gray-400">Input Tokens</dt>
                        <dd className="font-mono text-blue-300">{formatTokens(item.inputTokens)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-gray-400">Output Tokens</dt>
                        <dd className="font-mono text-blue-300">{formatTokens(item.outputTokens)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-gray-400">Total Tokens</dt>
                        <dd className="font-mono">{formatTokens(item.totalTokens)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-gray-400">Calls</dt>
                        <dd className="font-mono">{item.calls.toLocaleString()}</dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </div>

              <details className="border border-white/10 rounded-lg overflow-hidden">
                <summary className="p-3 cursor-pointer text-sm text-gray-400 hover:text-white list-none flex items-center gap-2">
                  <span>View as accessible data table</span>
                  <span className="ml-auto text-gray-500">▼</span>
                </summary>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" role="table">
                    <thead>
                      <tr className="text-left border-b border-white/10 text-gray-400">
                        <th className="py-2 px-3" scope="col">Model</th>
                        <th className="py-2 px-3" scope="col">Est. Cost</th>
                        <th className="py-2 px-3" scope="col">Input Tokens</th>
                        <th className="py-2 px-3" scope="col">Output Tokens</th>
                        <th className="py-2 px-3" scope="col">Total Tokens</th>
                        <th className="py-2 px-3" scope="col">Calls</th>
                      </tr>
                    </thead>
                    <tbody>
                      {modelBreakdown.map((item) => (
                        <tr key={item.model} className="border-b border-white/5">
                          <td className="py-2 px-3 font-medium">{item.model}</td>
                          <td className="py-2 px-3 font-mono">{formatCost(item.cost)}</td>
                          <td className="py-2 px-3 font-mono">{formatTokens(item.inputTokens)}</td>
                          <td className="py-2 px-3 font-mono">{formatTokens(item.outputTokens)}</td>
                          <td className="py-2 px-3 font-mono">{formatTokens(item.totalTokens)}</td>
                          <td className="py-2 px-3 font-mono">{item.calls.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </section>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          {/* Table View - Full Data Tables */}
          <section aria-labelledby="tokens-table-title" className="space-y-4">
            <h3 id="tokens-table-title" className="text-lg font-medium">Tokens Over Time ({bucketName})</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" role="table">
                <thead>
                  <tr className="text-left border-b border-white/10 text-gray-400">
                    <th className="py-2 px-3" scope="col">Period</th>
                    <th className="py-2 px-3" scope="col">Input Tokens</th>
                    <th className="py-2 px-3" scope="col">Output Tokens</th>
                    <th className="py-2 px-3" scope="col">Total Tokens</th>
                    <th className="py-2 px-3" scope="col">Est. Cost</th>
                    <th className="py-2 px-3" scope="col">Calls</th>
                  </tr>
                </thead>
                <tbody>
                  {timeSeries.map((point) => (
                    <tr key={point.timestamp} className="border-b border-white/5">
                      <td className="py-2 px-3">{point.label}</td>
                      <td className="py-2 px-3 font-mono">{formatTokens(point.inputTokens)}</td>
                      <td className="py-2 px-3 font-mono">{formatTokens(point.outputTokens)}</td>
                      <td className="py-2 px-3 font-mono">{formatTokens(point.totalTokens)}</td>
                      <td className="py-2 px-3 font-mono">{formatCost(point.cost)}</td>
                      <td className="py-2 px-3 font-mono">{point.calls}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {appBreakdown.length > 0 && (
            <section aria-labelledby="app-table-title" className="space-y-4">
              <h3 id="app-table-title" className="text-lg font-medium">Cost Breakdown by App</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" role="table">
                  <thead>
                    <tr className="text-left border-b border-white/10 text-gray-400">
                      <th className="py-2 px-3" scope="col">App</th>
                      <th className="py-2 px-3" scope="col">Est. Cost</th>
                      <th className="py-2 px-3" scope="col">Input Tokens</th>
                      <th className="py-2 px-3" scope="col">Output Tokens</th>
                      <th className="py-2 px-3" scope="col">Total Tokens</th>
                      <th className="py-2 px-3" scope="col">Calls</th>
                    </tr>
                  </thead>
                  <tbody>
                    {appBreakdown.map((item) => (
                      <tr key={item.app} className="border-b border-white/5">
                        <td className="py-2 px-3 font-medium">{item.app}</td>
                        <td className="py-2 px-3 font-mono">{formatCost(item.cost)}</td>
                        <td className="py-2 px-3 font-mono">{formatTokens(item.inputTokens)}</td>
                        <td className="py-2 px-3 font-mono">{formatTokens(item.outputTokens)}</td>
                        <td className="py-2 px-3 font-mono">{formatTokens(item.totalTokens)}</td>
                        <td className="py-2 px-3 font-mono">{item.calls.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {modelBreakdown.length > 0 && (
            <section aria-labelledby="model-table-title" className="space-y-4">
              <h3 id="model-table-title" className="text-lg font-medium">Cost Breakdown by Model (Top 5 + Other)</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" role="table">
                  <thead>
                    <tr className="text-left border-b border-white/10 text-gray-400">
                      <th className="py-2 px-3" scope="col">Model</th>
                      <th className="py-2 px-3" scope="col">Est. Cost</th>
                      <th className="py-2 px-3" scope="col">Input Tokens</th>
                      <th className="py-2 px-3" scope="col">Output Tokens</th>
                      <th className="py-2 px-3" scope="col">Total Tokens</th>
                      <th className="py-2 px-3" scope="col">Calls</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modelBreakdown.map((item) => (
                      <tr key={item.model} className="border-b border-white/5">
                        <td className="py-2 px-3 font-medium">{item.model}</td>
                        <td className="py-2 px-3 font-mono">{formatCost(item.cost)}</td>
                        <td className="py-2 px-3 font-mono">{formatTokens(item.inputTokens)}</td>
                        <td className="py-2 px-3 font-mono">{formatTokens(item.outputTokens)}</td>
                        <td className="py-2 px-3 font-mono">{formatTokens(item.totalTokens)}</td>
                        <td className="py-2 px-3 font-mono">{item.calls.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
