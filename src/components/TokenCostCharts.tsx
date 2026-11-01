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
}

interface TokenCostChartsProps {
  password: string;
  appName?: string;
  model?: string;
  bucket?: Bucket;
  startTime?: number;
  endTime?: number;
}

export function TokenCostCharts({
  password,
  appName,
  model,
  bucket = "day",
  startTime,
  endTime,
}: TokenCostChartsProps) {
  const [viewMode, setViewMode] = useState<"chart" | "table">("chart");
  const [selectedBucket, setSelectedBucket] = useState<Bucket>(bucket);

  const aggregates = useQuery(api.usage.getTokenCostAggregates, {
    dashboardPassword: password,
    appName: appName as any,
    model,
    bucket: selectedBucket,
    startTime,
    endTime,
  });

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
      </div>
    );
  }

  const maxTokens = useMemo(() => Math.max(...timeSeries.map((p) => p.totalTokens), 1), [timeSeries]);
  const maxCost = useMemo(() => Math.max(...timeSeries.map((p) => p.cost), 0.001), [timeSeries]);

  const formatCost = (cost: number) => `$${cost.toFixed(cost < 0.01 ? 4 : 2)}`;
  const formatTokens = (tokens: number) => tokens.toLocaleString();

  const chartHeight = 300;
  const barWidth = Math.max(24, Math.min(60, 800 / Math.max(timeSeries.length, 1)));
  const chartWidth = Math.max(400, timeSeries.length * (barWidth + 8));

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
                <div className="text-gray-500">In: ${prices.input.toFixed(2)} / Out: ${prices.output.toFixed(2)} per 1M</div>
              </div>
            ))}
            <div className="bg-white/5 p-2 rounded">
              <div className="font-mono text-white">Default (unknown models)</div>
              <div className="text-gray-500">In: ${defaultPrice.input.toFixed(2)} / Out: ${defaultPrice.output.toFixed(2)} per 1M</div>
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
              <span className="text-xs text-gray-500 font-normal">(stacked bars, {selectedBucket}ly buckets)</span>
            </h3>
            <div className="relative" style={{ height: chartHeight, width: chartWidth, minWidth: "100%" }} role="img" aria-label="Stacked bar chart showing input and output tokens over time">
              <svg
                viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                preserveAspectRatio="none"
                className="w-full h-full"
                role="graphics-document"
              >
                {/* Y-axis grid lines and labels */}
                <g stroke="white" stroke-opacity="0.05" stroke-width="1">
                  {[0, 0.25, 0.5, 0.75, 1].forEach((frac) => {
                    const y = chartHeight * (1 - frac) - 20;
                    return (
                      <line key={frac} x1={0} y1={y} x2={chartWidth} y2={y} />
                    );
                  })}
                </g>
                <g fontSize="10" fill="white" fillOpacity="0.5" textAnchor="end">
                  {[0, 0.25, 0.5, 0.75, 1].map((frac) => (
                    <text key={frac} x={-8} y={chartHeight * (1 - frac) - 16} dominantBaseline="middle">
                      {formatTokens(maxTokens * frac)}
                    </text>
                  ))}
                </g>

                {/* Bars */}
                <g>
                  {timeSeries.map((point, i) => {
                    const x = i * (barWidth + 8) + 40;
                    const inputHeight = (point.inputTokens / maxTokens) * (chartHeight - 40);
                    const outputHeight = (point.outputTokens / maxTokens) * (chartHeight - 40);
                    const yBase = chartHeight - 20;

                    return (
                      <g key={point.timestamp} transform={`translate(${x}, 0)`}>
                        {/* Output tokens (top) */}
                        <rect
                          x={0}
                          y={yBase - inputHeight - outputHeight}
                          width={barWidth}
                          height={outputHeight}
                          fill="#60a5fa"
                          rx={2}
                          role="graphics-symbol"
                          aria-label={`Output tokens: ${formatTokens(point.outputTokens)}`}
                        />
                        {/* Input tokens (bottom) */}
                        <rect
                          x={0}
                          y={yBase - inputHeight}
                          width={barWidth}
                          height={inputHeight}
                          fill="#3b82f6"
                          rx={2}
                          role="graphics-symbol"
                          aria-label={`Input tokens: ${formatTokens(point.inputTokens)}`}
                        />
                        {/* X-axis label */}
                        <text
                          x={barWidth / 2}
                          y={chartHeight - 4}
                          textAnchor="middle"
                          fontSize="10"
                          fill="white"
                          fillOpacity="0.6"
                          dominantBaseline="hanging"
                        >
                          {point.label}
                        </text>
                      </g>
                    );
                  })}
                </g>

                {/* Legend */}
                <g transform={`translate(${chartWidth - 160}, 20)`}>
                  <rect x={0} y={0} width={12} height={12} fill="#3b82f6" rx={2} />
                  <text x={18} y={10} fontSize="11" fill="white" dominantBaseline="middle">Input tokens</text>
                  <rect x={0} y={20} width={12} height={12} fill="#60a5fa" rx={2} />
                  <text x={18} y={30} fontSize="11" fill="white" dominantBaseline="middle">Output tokens</text>
                </g>
              </svg>
            </div>

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
              <span className="text-xs text-gray-500 font-normal">({selectedBucket}ly buckets)</span>
            </h3>
            <div className="relative" style={{ height: chartHeight, width: chartWidth, minWidth: "100%" }} role="img" aria-label="Bar chart showing estimated cost over time">
              <svg
                viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                preserveAspectRatio="none"
                className="w-full h-full"
                role="graphics-document"
              >
                <g stroke="white" stroke-opacity="0.05" stroke-width="1">
                  {[0, 0.25, 0.5, 0.75, 1].forEach((frac) => {
                    const y = chartHeight * (1 - frac) - 20;
                    return <line key={frac} x1={0} y1={y} x2={chartWidth} y2={y} />;
                  })}
                </g>
                <g fontSize="10" fill="white" fillOpacity="0.5" textAnchor="end">
                  {[0, 0.25, 0.5, 0.75, 1].map((frac) => (
                    <text key={frac} x={-8} y={chartHeight * (1 - frac) - 16} dominantBaseline="middle">
                      {formatCost(maxCost * frac)}
                    </text>
                  ))}
                </g>

                <g>
                  {timeSeries.map((point, i) => {
                    const x = i * (barWidth + 8) + 40;
                    const costHeight = (point.cost / maxCost) * (chartHeight - 40);
                    const yBase = chartHeight - 20;

                    return (
                      <g key={point.timestamp} transform={`translate(${x}, 0)`}>
                        <rect
                          x={0}
                          y={yBase - costHeight}
                          width={barWidth}
                          height={Math.max(costHeight, 1)}
                          fill="#22c55e"
                          rx={2}
                          role="graphics-symbol"
                          aria-label={`Cost: ${formatCost(point.cost)}`}
                        />
                        <text
                          x={barWidth / 2}
                          y={chartHeight - 4}
                          textAnchor="middle"
                          fontSize="10"
                          fill="white"
                          fillOpacity="0.6"
                          dominantBaseline="hanging"
                        >
                          {point.label}
                        </text>
                      </g>
                    );
                  })}
                </g>
              </svg>
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
            <h3 id="tokens-table-title" className="text-lg font-medium">Tokens Over Time ({selectedBucket}ly)</h3>
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
