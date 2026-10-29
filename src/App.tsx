import { useState, useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Link,
  Navigate,
  useLocation,
  useParams,
} from "react-router-dom";

const APPS = ["yatra-ai-next", "dalal-street-ai", "rootcause-ai", "pcmace-ai", "doubtmail-ai", "skybot"] as const;

type DateRangePreset = "24h" | "7d" | "30d" | "all" | "custom";
const DATE_RANGES: DateRangePreset[] = ["24h", "7d", "30d", "all", "custom"];
const DAY_MS = 24 * 60 * 60 * 1000;

const PRESET_MS: Record<Exclude<DateRangePreset, "custom">, number | null> = {
  "24h": DAY_MS,
  "7d": 7 * DAY_MS,
  "30d": 30 * DAY_MS,
  "all": null,
};

interface UsageRecord {
  _id: string;
  appName: string;
  feature?: string | null;
  model: string;
  totalTokens: number;
  latencyMs: number;
  success: boolean;
  createdAt: number;
}

const isKnownApp = (name: string): name is (typeof APPS)[number] => (APPS as readonly string[]).includes(name);

const toggle = (list: string[], item: string, checked: boolean): string[] =>
  checked ? (list.includes(item) ? list : [...list, item]) : list.filter((x) => x !== item);

function useAllRecords(password: string) {
  return APPS.map((app) =>
    useQuery(
      api.usage.getUsageRecords,
      password ? { dashboardPassword: password, appName: app, limit: 500 } : "skip",
    ),
  );
}

// ---------------------------------------------------------------------------
// Global filters (SCRUM-42): state lives in <App>, is mirrored into the URL,
// and is applied by every usage page.
// ---------------------------------------------------------------------------
interface FilterValues {
  dateRange: DateRangePreset;
  selectedApps: string[];
  selectedModels: string[];
  customStart: string;
  customEnd: string;
}

interface Filters extends FilterValues {
  setDateRange: (v: DateRangePreset) => void;
  setSelectedApps: (v: string[]) => void;
  setSelectedModels: (v: string[]) => void;
  setCustomStart: (v: string) => void;
  setCustomEnd: (v: string) => void;
  availableModels: string[];
  clearAllFilters: () => void;
  hasActiveFilters: boolean;
}

function parseUrlFilters(): FilterValues {
  if (typeof window === "undefined") {
    return { dateRange: "7d", selectedApps: [...APPS], selectedModels: [], customStart: "", customEnd: "" };
  }
  const params = new URLSearchParams(window.location.search);
  const rawRange = params.get("dateRange");
  const dateRange = DATE_RANGES.includes(rawRange as DateRangePreset) ? (rawRange as DateRangePreset) : "7d";
  const selectedApps =
    params.get("apps")?.split(",").filter(isKnownApp) ?? [...APPS];
  const selectedModels = params.get("models")?.split(",").filter(Boolean) ?? [];
  const customStart = params.get("customStart") ?? "";
  const customEnd = params.get("customEnd") ?? "";
  return { dateRange, selectedApps, selectedModels, customStart, customEnd };
}

function writeUrlFilters(f: FilterValues) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams();
  if (f.dateRange !== "7d") params.set("dateRange", f.dateRange);
  if (f.selectedApps.length !== APPS.length) params.set("apps", f.selectedApps.join(","));
  if (f.selectedModels.length > 0) params.set("models", f.selectedModels.join(","));
  if (f.dateRange === "custom" && f.customStart) params.set("customStart", f.customStart);
  if (f.dateRange === "custom" && f.customEnd) params.set("customEnd", f.customEnd);
  const newUrl = `${window.location.pathname}${params.toString() ? "?" + params.toString() : ""}`;
  window.history.replaceState(null, "", newUrl);
}

/** Records inside the chosen window (current) and in the equally long window before it (previous).
 *  Windows are anchored on the newest record, not on "now", so old data still shows numbers.
 *  The model filter is applied to both windows so the deltas compare like with like. */
function splitPeriods(records: UsageRecord[], f: FilterValues) {
  const scoped = f.selectedModels.length > 0 ? records.filter((r) => f.selectedModels.includes(r.model)) : records;
  const newest = records.length ? Math.max(...records.map((r) => r.createdAt)) : Date.now();

  if (f.dateRange === "custom") {
    const start = f.customStart ? new Date(f.customStart).getTime() : 0;
    const end = f.customEnd ? new Date(f.customEnd).getTime() + DAY_MS - 1 : newest;
    const span = end - start;
    return {
      current: scoped.filter((r) => r.createdAt >= start && r.createdAt <= end),
      previous: span > 0 ? scoped.filter((r) => r.createdAt < start && r.createdAt >= start - span) : [],
    };
  }

  const windowMs = PRESET_MS[f.dateRange];
  const cutoff = windowMs ? newest - windowMs : 0;
  return {
    current: scoped.filter((r) => r.createdAt >= cutoff),
    previous: windowMs
      ? scoped.filter((r) => r.createdAt < newest - windowMs && r.createdAt >= newest - 2 * windowMs)
      : [],
  };
}

const pctChange = (cur: number, prev: number): number | null => (prev > 0 ? ((cur - prev) / prev) * 100 : null);

function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil(0.95 * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

function computeKpis(current: UsageRecord[], previous: UsageRecord[]) {
  const errorRate = (rs: UsageRecord[]) => (rs.length > 0 ? (rs.filter((r) => !r.success).length / rs.length) * 100 : 0);
  const tokens = (rs: UsageRecord[]) => rs.reduce((s, r) => s + r.totalTokens, 0);
  const latencies = (rs: UsageRecord[]) => rs.map((r) => r.latencyMs);
  return {
    requests: current.length,
    requestsDelta: pctChange(current.length, previous.length),
    tokens: tokens(current),
    tokensDelta: pctChange(tokens(current), tokens(previous)),
    p95: p95(latencies(current)),
    p95Delta: pctChange(p95(latencies(current)), p95(latencies(previous))),
    errorRate: errorRate(current),
    errorRateDelta: pctChange(errorRate(current), errorRate(previous)),
  };
}

function summarize(rs: UsageRecord[]) {
  const calls = rs.length;
  return {
    calls,
    tokens: rs.reduce((s, r) => s + r.totalTokens, 0),
    avgLatency: calls ? rs.reduce((s, r) => s + r.latencyMs, 0) / calls : 0,
    failures: rs.filter((r) => !r.success).length,
  };
}

// ---------------------------------------------------------------------------
// App: password gate + filter state
// ---------------------------------------------------------------------------
export default function App() {
  const [password, setPassword] = useState("");
  const [submitted, setSubmitted] = useState("");

  const [initial] = useState(parseUrlFilters);
  const [dateRange, setDateRange] = useState<DateRangePreset>(initial.dateRange);
  const [selectedApps, setSelectedApps] = useState<string[]>(initial.selectedApps);
  const [selectedModels, setSelectedModels] = useState<string[]>(initial.selectedModels);
  const [customStart, setCustomStart] = useState<string>(initial.customStart);
  const [customEnd, setCustomEnd] = useState<string>(initial.customEnd);

  const recordSets = useAllRecords(submitted);

  if (!submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(password);
          }}
          className="bg-white/5 p-8 rounded-xl space-y-4 w-80"
        >
          <h1 className="text-xl font-semibold">LLM Usage Tracker</h1>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Dashboard password"
            className="w-full bg-white/10 rounded px-3 py-2"
          />
          <button className="w-full bg-white text-black rounded py-2 font-medium">Enter</button>
        </form>
      </div>
    );
  }

  const modelSet = new Set<string>();
  for (const records of recordSets) records?.forEach((r) => modelSet.add(r.model));
  const availableModels = Array.from(modelSet).sort();

  const clearAllFilters = () => {
    setDateRange("7d");
    setSelectedApps([...APPS]);
    setSelectedModels([]);
    setCustomStart("");
    setCustomEnd("");
  };

  // A custom range is already "not 7d", so no separate check for its dates is needed.
  const hasActiveFilters =
    dateRange !== "7d" || selectedApps.length !== APPS.length || selectedModels.length > 0;

  const filters: Filters = {
    dateRange,
    selectedApps,
    selectedModels,
    customStart,
    customEnd,
    setDateRange,
    setSelectedApps,
    setSelectedModels,
    setCustomStart,
    setCustomEnd,
    availableModels,
    clearAllFilters,
    hasActiveFilters,
  };

  return (
    <Router>
      <DashboardLayout password={submitted} filters={filters} />
    </Router>
  );
}

// ---------------------------------------------------------------------------
// Layout and navigation (SCRUM-40)
// ---------------------------------------------------------------------------
const FILTERED_ROUTES = ["/overview", "/apps", "/requests"];

function DashboardLayout({ password, filters }: { password: string; filters: Filters }) {
  const location = useLocation();
  const { dateRange, selectedApps, selectedModels, customStart, customEnd } = filters;

  // Keep the filters in the address bar (shareable links), and put them back after navigating between pages.
  useEffect(() => {
    writeUrlFilters({ dateRange, selectedApps, selectedModels, customStart, customEnd });
  }, [location.pathname, dateRange, selectedApps, selectedModels, customStart, customEnd]);

  const navItems = [
    { path: "/overview", label: "Overview" },
    { path: "/apps", label: "Apps" },
    { path: "/evals", label: "Evals" },
    { path: "/requests", label: "Requests" },
  ] as const;

  const showFilters = FILTERED_ROUTES.some((p) => location.pathname === p || location.pathname.startsWith(p + "/"));

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-white/10 sticky top-0 bg-gray-950/95 backdrop-blur z-10">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex items-center justify-between h-16">
            <h1 className="text-xl font-semibold">LLM Usage Tracker</h1>
            <nav className="flex gap-1" role="navigation" aria-label="Main navigation">
              {navItems.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`rounded-lg px-4 py-2 text-sm font-medium border transition-colors ${
                    location.pathname === item.path
                      ? "border-white bg-white/10 text-white"
                      : "border-white/10 bg-white/5 text-gray-400 hover:text-white hover:border-white/20"
                  }`}
                  aria-current={location.pathname === item.path ? "page" : undefined}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {showFilters && <FilterBar filters={filters} />}
        <Routes>
          <Route path="/overview" element={<OverviewPage password={password} filters={filters} />} />
          <Route path="/apps" element={<AppsPage password={password} filters={filters} />} />
          <Route path="/apps/:appName" element={<AppDetailPage password={password} filters={filters} />} />
          <Route path="/evals" element={<EvalsPage password={password} />} />
          <Route path="/requests" element={<RequestsPage password={password} filters={filters} />} />
          <Route path="/" element={<NavigateToOverview />} />
          <Route path="*" element={<NavigateToOverview />} />
        </Routes>
      </main>
    </div>
  );
}

function NavigateToOverview() {
  return <Navigate to="/overview" replace />;
}

function FilterBar({ filters }: { filters: Filters }) {
  const {
    dateRange,
    setDateRange,
    selectedApps,
    setSelectedApps,
    selectedModels,
    setSelectedModels,
    availableModels,
    clearAllFilters,
    hasActiveFilters,
    customStart,
    setCustomStart,
    customEnd,
    setCustomEnd,
  } = filters;

  return (
    <div className="rounded-lg border border-white/10 p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-400">Date range:</label>
          <div className="flex gap-1 bg-white/5 rounded p-1">
            {DATE_RANGES.map((preset) => (
              <button
                key={preset}
                onClick={() => setDateRange(preset)}
                className={`px-3 py-1.5 text-xs rounded ${
                  dateRange === preset ? "bg-white/10 text-white" : "text-gray-400 hover:text-white"
                }`}
              >
                {preset === "all" ? "All" : preset === "custom" ? "Custom" : preset}
              </button>
            ))}
          </div>
        </div>

        {dateRange === "custom" && (
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400">From:</label>
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-white/20"
            />
            <label className="text-xs text-gray-400">To:</label>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-white/20"
            />
          </div>
        )}

        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-400">Apps:</label>
          <div className="flex gap-1 bg-white/5 rounded p-1 flex-wrap">
            {APPS.map((app) => (
              <label key={app} className="flex items-center gap-1 px-2 py-1.5 text-xs rounded cursor-pointer hover:bg-white/5">
                <input
                  type="checkbox"
                  checked={selectedApps.includes(app)}
                  onChange={(e) => setSelectedApps(toggle(selectedApps, app, e.target.checked))}
                  className="rounded border-white/20 text-white bg-white/5 focus:ring-2 focus:ring-white/20"
                />
                <span>{app}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-400">Models (none ticked = all):</label>
          <div className="flex gap-1 bg-white/5 rounded p-1 flex-wrap">
            {availableModels.map((model) => (
              <label key={model} className="flex items-center gap-1 px-2 py-1.5 text-xs rounded cursor-pointer hover:bg-white/5">
                <input
                  type="checkbox"
                  checked={selectedModels.includes(model)}
                  onChange={(e) => setSelectedModels(toggle(selectedModels, model, e.target.checked))}
                  className="rounded border-white/20 text-white bg-white/5 focus:ring-2 focus:ring-white/20"
                />
                <span>{model}</span>
              </label>
            ))}
          </div>
        </div>

        {hasActiveFilters && (
          <button onClick={clearAllFilters} className="ml-auto text-xs text-gray-400 hover:text-white underline">
            Clear all
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------
function KpiRow({ kpis }: { kpis: ReturnType<typeof computeKpis> }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <KpiCard label="Requests" value={kpis.requests} delta={kpis.requestsDelta} isGood={(d) => d >= 0} />
      <KpiCard
        label="Tokens"
        value={kpis.tokens}
        delta={kpis.tokensDelta}
        isGood={(d) => d >= 0}
        format={(n) => n.toLocaleString()}
      />
      <KpiCard
        label="P95 latency"
        value={kpis.p95}
        delta={kpis.p95Delta}
        isGood={(d) => d <= 0}
        format={(n) => `${n.toFixed(0)} ms`}
      />
      <KpiCard
        label="Error rate"
        value={kpis.errorRate}
        delta={kpis.errorRateDelta}
        isGood={(d) => d <= 0}
        format={(n) => `${n.toFixed(1)}%`}
      />
    </div>
  );
}

function StatRow({ rs }: { rs: UsageRecord[] }) {
  const s = summarize(rs);
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard label="Calls" value={s.calls.toLocaleString()} />
      <StatCard label="Total tokens" value={s.tokens.toLocaleString()} />
      <StatCard label="Avg latency" value={`${s.avgLatency.toFixed(0)} ms`} />
      <StatCard label="Failures" value={s.failures} />
    </div>
  );
}

function groupByApp(rs: UsageRecord[]) {
  const byApp = new Map<string, { calls: number; tokens: number; latencySum: number; failures: number }>();
  for (const r of rs) {
    const existing = byApp.get(r.appName) ?? { calls: 0, tokens: 0, latencySum: 0, failures: 0 };
    existing.calls += 1;
    existing.tokens += r.totalTokens;
    existing.latencySum += r.latencyMs;
    if (!r.success) existing.failures += 1;
    byApp.set(r.appName, existing);
  }
  return byApp;
}

function OverviewPage({ password, filters }: { password: string; filters: Filters }) {
  const records = useQuery(api.usage.getUsageRecords, {
    dashboardPassword: password,
    limit: 2000,
  });

  if (records === undefined) {
    return <LoadingState message="Loading overview…" />;
  }

  const inScope = records.filter((r) => filters.selectedApps.includes(r.appName));
  const { current, previous } = splitPeriods(inScope, filters);
  const byApp = groupByApp(current);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold mb-2">Overview</h2>
        <p className="text-gray-400 text-sm">Cross-app summary of LLM usage</p>
      </div>

      <StatRow rs={current} />
      <KpiRow kpis={computeKpis(current, previous)} />

      <section className="space-y-4">
        <h3 className="text-lg font-medium">By app</h3>
        {byApp.size === 0 ? (
          <EmptyState message="No usage data for the selected filters." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left border-b border-white/10 text-gray-400">
                  <th className="py-3 px-4">App</th>
                  <th className="py-3 px-4">Calls</th>
                  <th className="py-3 px-4">Tokens</th>
                  <th className="py-3 px-4">Avg latency</th>
                  <th className="py-3 px-4">Failures</th>
                </tr>
              </thead>
              <tbody>
                {Array.from(byApp.entries())
                  .sort((a, b) => b[1].calls - a[1].calls)
                  .map(([app, data]) => (
                    <tr key={app} className="border-b border-white/5 hover:bg-white/5">
                      <td className="py-3 px-4">
                        <Link to={`/apps/${app}`} className="text-blue-400 hover:underline font-medium">
                          {app}
                        </Link>
                      </td>
                      <td className="py-3 px-4">{data.calls.toLocaleString()}</td>
                      <td className="py-3 px-4">{data.tokens.toLocaleString()}</td>
                      <td className="py-3 px-4">{(data.latencySum / data.calls).toFixed(0)} ms</td>
                      <td className="py-3 px-4">{data.failures}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function AppsPage({ password, filters }: { password: string; filters: Filters }) {
  const records = useQuery(api.usage.getUsageRecords, {
    dashboardPassword: password,
    limit: 2000,
  });

  if (records === undefined) {
    return <LoadingState message="Loading apps…" />;
  }

  const inScope = records.filter((r) => filters.selectedApps.includes(r.appName));
  const { current } = splitPeriods(inScope, filters);
  const byApp = groupByApp(current);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold mb-2">Apps</h2>
        <p className="text-gray-400 text-sm">All apps with LLM usage</p>
      </div>

      {byApp.size === 0 ? (
        <EmptyState message="No apps have recorded usage for the selected filters." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from(byApp.entries())
            .sort((a, b) => b[1].calls - a[1].calls)
            .map(([app, data]) => (
              <Link
                key={app}
                to={`/apps/${app}`}
                className="rounded-lg border border-white/10 p-5 hover:border-white/20 hover:bg-white/5 transition-colors"
              >
                <h3 className="font-medium text-lg">{app}</h3>
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-gray-500">Calls</div>
                    <div className="font-semibold">{data.calls.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Tokens</div>
                    <div className="font-semibold">{data.tokens.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Avg latency</div>
                    <div className="font-semibold">{(data.latencySum / data.calls).toFixed(0)} ms</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Failures</div>
                    <div className="font-semibold">{data.failures}</div>
                  </div>
                </div>
              </Link>
            ))}
        </div>
      )}
    </div>
  );
}

function AppDetailPage({ password, filters }: { password: string; filters: Filters }) {
  const { appName = "" } = useParams<{ appName: string }>();
  const knownApp = isKnownApp(appName) ? appName : null;

  // Always call the hook (even for an unknown app) so the hook order never changes between renders.
  const records = useQuery(
    api.usage.getUsageRecords,
    knownApp ? { dashboardPassword: password, appName: knownApp, limit: 500 } : "skip",
  );

  if (!knownApp) {
    return <ErrorState message={`Unknown app: ${appName}`} />;
  }

  if (records === undefined) {
    return <LoadingState message={`Loading ${appName}…`} />;
  }

  const { current, previous } = splitPeriods(records, filters);

  const byFeature = new Map<string, { calls: number; tokens: number; latencySum: number }>();
  const byModel = new Map<string, { calls: number; tokens: number; latencySum: number }>();
  for (const r of current) {
    const feat = r.feature ?? "—";
    const f = byFeature.get(feat) ?? { calls: 0, tokens: 0, latencySum: 0 };
    f.calls += 1;
    f.tokens += r.totalTokens;
    f.latencySum += r.latencyMs;
    byFeature.set(feat, f);

    const m = byModel.get(r.model) ?? { calls: 0, tokens: 0, latencySum: 0 };
    m.calls += 1;
    m.tokens += r.totalTokens;
    m.latencySum += r.latencyMs;
    byModel.set(r.model, m);
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <Link to="/apps" className="text-gray-400 hover:text-white text-sm mb-1 inline-block">
            ← All apps
          </Link>
          <h2 className="text-2xl font-semibold">{appName}</h2>
        </div>
      </div>

      <StatRow rs={current} />
      <KpiRow kpis={computeKpis(current, previous)} />

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-4">
          <h3 className="text-lg font-medium">By feature</h3>
          {byFeature.size === 0 ? (
            <EmptyState message="No feature data." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="text-left border-b border-white/10 text-gray-400">
                    <th className="py-2 px-4">Feature</th>
                    <th className="py-2 px-4">Calls</th>
                    <th className="py-2 px-4">Tokens</th>
                    <th className="py-2 px-4">Avg latency</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from(byFeature.entries())
                    .sort((a, b) => b[1].calls - a[1].calls)
                    .map(([feature, data]) => (
                      <tr key={feature} className="border-b border-white/5">
                        <td className="py-2 px-4">{feature}</td>
                        <td className="py-2 px-4">{data.calls}</td>
                        <td className="py-2 px-4">{data.tokens.toLocaleString()}</td>
                        <td className="py-2 px-4">{(data.latencySum / data.calls).toFixed(0)} ms</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="space-y-4">
          <h3 className="text-lg font-medium">By model</h3>
          {byModel.size === 0 ? (
            <EmptyState message="No model data." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="text-left border-b border-white/10 text-gray-400">
                    <th className="py-2 px-4">Model</th>
                    <th className="py-2 px-4">Calls</th>
                    <th className="py-2 px-4">Tokens</th>
                    <th className="py-2 px-4">Avg latency</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from(byModel.entries())
                    .sort((a, b) => b[1].calls - a[1].calls)
                    .map(([model, data]) => (
                      <tr key={model} className="border-b border-white/5">
                        <td className="py-2 px-4">{model}</td>
                        <td className="py-2 px-4">{data.calls}</td>
                        <td className="py-2 px-4">{data.tokens.toLocaleString()}</td>
                        <td className="py-2 px-4">{(data.latencySum / data.calls).toFixed(0)} ms</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <section className="space-y-4">
        <h3 className="text-lg font-medium">Recent requests</h3>
        {current.length === 0 ? (
          <EmptyState message="No requests recorded for the selected filters." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left border-b border-white/10 text-gray-400">
                  <th className="py-2 px-4">Feature</th>
                  <th className="py-2 px-4">Model</th>
                  <th className="py-2 px-4">Tokens</th>
                  <th className="py-2 px-4">Latency</th>
                  <th className="py-2 px-4">Status</th>
                  <th className="py-2 px-4">Time</th>
                </tr>
              </thead>
              <tbody>
                {current.slice(0, 50).map((r) => (
                  <tr key={r._id} className="border-b border-white/5">
                    <td className="py-2 px-4">{r.feature ?? "—"}</td>
                    <td className="py-2 px-4">{r.model}</td>
                    <td className="py-2 px-4">{r.totalTokens}</td>
                    <td className="py-2 px-4">{r.latencyMs} ms</td>
                    <td className="py-2 px-4">
                      <span className={r.success ? "text-green-400" : "text-red-400"}>
                        {r.success ? "Success" : "Failed"}
                      </span>
                    </td>
                    <td className="py-2 px-4">{new Date(r.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function EvalsPage({ password }: { password: string }) {
  const overallStats = useQuery(api.evals.getEvalStats, {
    dashboardPassword: password,
  });

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold mb-2">Evals</h2>
        <p className="text-gray-400 text-sm mb-6">
          Read-only performance view — human review happens in each app directly. This
          shows how well the LLM-as-judge is scoring outputs across apps.
        </p>
      </div>

      {overallStats === undefined && <LoadingState message="Loading eval stats…" />}

      {overallStats && overallStats.total === 0 && (
        <EmptyState message="No evals recorded yet across any app." />
      )}

      {overallStats && overallStats.total > 0 && (
        <>
          <section className="space-y-4">
            <h3 className="text-lg font-medium">Overall</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard label="Total evals" value={overallStats.total} />
              <StatCard label="Avg judge score" value={`${overallStats.avgJudgeScore.toFixed(1)} / 5`} />
              <StatCard
                label="Human approval rate"
                value={
                  overallStats.humanReviewedCount > 0
                    ? `${Math.round(overallStats.humanApprovalRate * 100)}%`
                    : "—"
                }
              />
              <StatCard
                label="Judge ↔ human agreement"
                value={
                  overallStats.humanReviewedCount > 0
                    ? `${Math.round(overallStats.judgeHumanAgreementRate * 100)}%`
                    : "—"
                }
              />
            </div>

            <div className="rounded-lg border border-white/10 p-5">
              <div className="text-sm text-gray-400 mb-3">Judge verdict breakdown</div>
              <VerdictBars
                verdictBreakdown={overallStats.verdictBreakdown}
                total={overallStats.total}
              />
            </div>
          </section>

          <section className="space-y-6">
            <h3 className="text-lg font-medium">By app</h3>
            {Object.entries(overallStats.byApp).map(([app, data]) => (
              <Link
                key={app}
                to={`/apps/${app}`}
                className="rounded-lg border border-white/10 p-5 hover:border-white/20 hover:bg-white/5 transition-colors block"
              >
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span className="text-gray-200 font-medium">{app}</span>
                  <div className="flex items-center gap-6 text-sm">
                    <span className="text-gray-400">{data.count} evals</span>
                    <span className="text-white font-medium">{data.avgScore.toFixed(1)} / 5 avg</span>
                    <span className="text-gray-400">
                      Human approval:{" "}
                      {data.humanReviewedCount > 0
                        ? `${Math.round(data.humanApprovalRate * 100)}%`
                        : "—"}
                    </span>
                  </div>
                </div>

                <VerdictBars verdictBreakdown={data.verdictBreakdown} total={data.count} />
              </Link>
            ))}
          </section>
        </>
      )}
    </div>
  );
}

function RequestsPage({ password, filters }: { password: string; filters: Filters }) {
  const records = useQuery(api.usage.getUsageRecords, {
    dashboardPassword: password,
    limit: 500,
  });

  if (records === undefined) {
    return <LoadingState message="Loading requests…" />;
  }

  const inScope = records.filter((r) => filters.selectedApps.includes(r.appName));
  const { current } = splitPeriods(inScope, filters);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold mb-2">Requests</h2>
        <p className="text-gray-400 text-sm">Requests across apps for the selected filters (latest 500 loaded)</p>
      </div>

      {current.length === 0 ? (
        <EmptyState message="No requests recorded for the selected filters." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left border-b border-white/10 text-gray-400">
                <th className="py-3 px-4">App</th>
                <th className="py-3 px-4">Feature</th>
                <th className="py-3 px-4">Model</th>
                <th className="py-3 px-4">Tokens</th>
                <th className="py-3 px-4">Latency</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Time</th>
              </tr>
            </thead>
            <tbody>
              {current.map((r) => (
                <tr key={r._id} className="border-b border-white/5">
                  <td className="py-3 px-4">
                    <Link to={`/apps/${r.appName}`} className="text-blue-400 hover:underline">
                      {r.appName}
                    </Link>
                  </td>
                  <td className="py-3 px-4">{r.feature ?? "—"}</td>
                  <td className="py-3 px-4">{r.model}</td>
                  <td className="py-3 px-4">{r.totalTokens}</td>
                  <td className="py-3 px-4">{r.latencyMs} ms</td>
                  <td className="py-3 px-4">
                    <span className={r.success ? "text-green-400" : "text-red-400"}>
                      {r.success ? "Success" : "Failed"}
                    </span>
                  </td>
                  <td className="py-3 px-4">{new Date(r.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------
function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-white/10 p-4">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  delta,
  isGood,
  format = (v: number) => String(v),
}: {
  label: string;
  value: number;
  delta: number | null;
  isGood: (delta: number) => boolean;
  format?: (value: number) => string;
}) {
  const displayValue = format(value);
  const hasDelta = delta !== null;
  const deltaText = hasDelta ? `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%` : "n/a";
  const deltaSign = hasDelta ? (delta >= 0 ? "▲" : "▼") : "";
  const isDeltaGood = hasDelta ? isGood(delta) : false;
  return (
    <div className="rounded-lg border border-white/10 p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-gray-500">{label}</div>
          <div className="text-lg font-semibold">{displayValue}</div>
        </div>
        <div className="text-xs flex items-center gap-1">
          {hasDelta ? (
            <>
              <span className={`text-sm font-medium ${isDeltaGood ? "text-green-400" : "text-red-400"}`}>
                {deltaSign}
              </span>
              <span className="text-gray-400">{deltaText}</span>
            </>
          ) : (
            <span className="text-gray-400">n/a</span>
          )}
        </div>
      </div>
    </div>
  );
}

function VerdictBars({
  verdictBreakdown,
  total,
}: {
  verdictBreakdown: { correct: number; partial: number; incorrect: number };
  total: number;
}) {
  return (
    <div className="space-y-2">
      {(["correct", "partial", "incorrect"] as const).map((v) => {
        const count = verdictBreakdown[v];
        const pct = total > 0 ? (count / total) * 100 : 0;
        const color =
          v === "correct" ? "bg-green-400" : v === "partial" ? "bg-yellow-400" : "bg-red-400";
        return (
          <div key={v}>
            <div className="flex justify-between text-xs text-gray-400 mb-1">
              <span className="capitalize">{v}</span>
              <span>{count} ({pct.toFixed(0)}%)</span>
            </div>
            <div className="w-full bg-white/10 rounded-full h-1.5">
              <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LoadingState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-12 text-gray-500">
      <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
      </svg>
      {message}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-white/10 p-8 text-center text-gray-500">
      {message}
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-8 text-center text-red-400">
      {message}
    </div>
  );
}