import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { BrowserRouter as Router, Routes, Route, Link, Navigate, useLocation, useNavigate } from "react-router-dom";

const APPS = ["yatra-ai-next", "dalal-street-ai", "rootcause-ai", "pcmace-ai", "doubtmail-ai", "skybot"] as const;

export default function App() {
  const [password, setPassword] = useState("");
  const [submitted, setSubmitted] = useState("");

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
          <button className="w-full bg-white text-black rounded py-2 font-medium">
            Enter
          </button>
        </form>
      </div>
    );
  }

  return (
    <Router>
      <DashboardLayout password={submitted} />
    </Router>
  );
}

function DashboardLayout({ password }: { password: string }) {
  const location = useLocation();
  const navigate = useNavigate();

  const navItems = [
    { path: "/overview", label: "Overview" },
    { path: "/apps", label: "Apps" },
    { path: "/evals", label: "Evals" },
    { path: "/requests", label: "Requests" },
  ] as const;

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

      <main className="max-w-7xl mx-auto px-6 py-8">
        <Routes>
          <Route path="/overview" element={<OverviewPage password={password} />} />
          <Route path="/apps" element={<AppsPage password={password} />} />
          <Route path="/apps/:appName" element={<AppDetailPage password={password} />} />
          <Route path="/evals" element={<EvalsPage password={password} />} />
          <Route path="/requests" element={<RequestsPage password={password} />} />
          <Route path="/" element={<NavigateToOverview />} />
        </Routes>
      </main>
    </div>
  );
}

function NavigateToOverview() {
  return <Navigate to="/overview" replace />;
}

function OverviewPage({ password }: { password: string }) {
  const records = useQuery(api.usage.getUsageRecords, {
    dashboardPassword: password,
    limit: 2000,
  });

  if (records === undefined) {
    return <LoadingState message="Loading overview…" />;
  }

  const totalCalls = records.length;
  const totalTokens = records.reduce((s, r) => s + r.totalTokens, 0);
  const avgLatency = totalCalls ? records.reduce((s, r) => s + r.latencyMs, 0) / totalCalls : 0;
  const failures = records.filter((r) => !r.success).length;

  const byApp = new Map<string, { calls: number; tokens: number; latencySum: number; failures: number }>();
  for (const r of records) {
    const existing = byApp.get(r.appName) ?? { calls: 0, tokens: 0, latencySum: 0, failures: 0 };
    existing.calls += 1;
    existing.tokens += r.totalTokens;
    existing.latencySum += r.latencyMs;
    if (!r.success) existing.failures += 1;
    byApp.set(r.appName, existing);
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold mb-2">Overview</h2>
        <p className="text-gray-400 text-sm">Cross-app summary of LLM usage</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total calls" value={totalCalls.toLocaleString()} />
        <StatCard label="Total tokens" value={totalTokens.toLocaleString()} />
        <StatCard label="Avg latency" value={`${avgLatency.toFixed(0)} ms`} />
        <StatCard label="Failures" value={failures} />
      </div>

      <section className="space-y-4">
        <h3 className="text-lg font-medium">By app</h3>
        {byApp.size === 0 ? (
          <EmptyState message="No usage data recorded yet." />
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
                        <Link
                          to={`/apps/${app}`}
                          className="text-blue-400 hover:underline font-medium"
                        >
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

function AppsPage({ password }: { password: string }) {
  const records = useQuery(api.usage.getUsageRecords, {
    dashboardPassword: password,
    limit: 2000,
  });

  if (records === undefined) {
    return <LoadingState message="Loading apps…" />;
  }

  const byApp = new Map<string, { calls: number; tokens: number; latencySum: number; failures: number }>();
  for (const r of records) {
    const existing = byApp.get(r.appName) ?? { calls: 0, tokens: 0, latencySum: 0, failures: 0 };
    existing.calls += 1;
    existing.tokens += r.totalTokens;
    existing.latencySum += r.latencyMs;
    if (!r.success) existing.failures += 1;
    byApp.set(r.appName, existing);
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold mb-2">Apps</h2>
        <p className="text-gray-400 text-sm">All apps with LLM usage</p>
      </div>

      {byApp.size === 0 ? (
        <EmptyState message="No apps have recorded usage yet." />
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

function AppDetailPage({ password }: { password: string }) {
  const location = useLocation();
  const appName = location.pathname.split("/apps/")[1] as (typeof APPS)[number];

  if (!APPS.includes(appName)) {
    return <ErrorState message={`Unknown app: ${appName}`} />;
  }

  const records = useQuery(api.usage.getUsageRecords, {
    dashboardPassword: password,
    appName,
    limit: 500,
  });

  if (records === undefined) {
    return <LoadingState message={`Loading ${appName}…`} />;
  }

  const calls = records.length;
  const totalTokens = records.reduce((s, r) => s + r.totalTokens, 0);
  const avgLatency = calls ? records.reduce((s, r) => s + r.latencyMs, 0) / calls : 0;
  const failures = records.filter((r) => !r.success).length;

  const byFeature = new Map<string, { calls: number; tokens: number; latencySum: number }>();
  const byModel = new Map<string, { calls: number; tokens: number; latencySum: number }>();
  for (const r of records) {
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

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Calls" value={calls.toLocaleString()} />
        <StatCard label="Total tokens" value={totalTokens.toLocaleString()} />
        <StatCard label="Avg latency" value={`${avgLatency.toFixed(0)} ms`} />
        <StatCard label="Failures" value={failures} />
      </div>

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
        {records.length === 0 ? (
          <EmptyState message="No requests recorded." />
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
                {records.slice(0, 50).map((r) => (
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

function RequestsPage({ password }: { password: string }) {
  const records = useQuery(api.usage.getUsageRecords, {
    dashboardPassword: password,
    limit: 500,
  });

  if (records === undefined) {
    return <LoadingState message="Loading requests…" />;
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold mb-2">Requests</h2>
        <p className="text-gray-400 text-sm">All requests across apps (latest 500)</p>
      </div>

      {records.length === 0 ? (
        <EmptyState message="No requests recorded yet." />
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
              {records.map((r) => (
                <tr key={r._id} className="border-b border-white/5">
                  <td className="py-3 px-4">
                    <Link
                      to={`/apps/${r.appName}`}
                      className="text-blue-400 hover:underline"
                    >
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

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-white/10 p-4">

      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
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
