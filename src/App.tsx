import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";

const APPS = ["yatra-ai-next", "dalal-street-ai", "rootcause-ai", "pcmace-ai"] as const;

export default function App() {
  const [password, setPassword] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [view, setView] = useState<"usage" | "evals">("usage");

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
    <div className="max-w-5xl mx-auto px-6 py-10 space-y-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          LLM Usage — YatraAI Next, DalalStreet AI & RootCause AI
        </h1>
        <div className="flex gap-2">
          <button
            onClick={() => setView("usage")}
            className={`rounded-lg px-4 py-2 text-sm font-medium border ${
              view === "usage" ? "border-white bg-white/10" : "border-white/10 bg-white/5 text-gray-400"
            }`}
          >
            Usage
          </button>
          <button
            onClick={() => setView("evals")}
            className={`rounded-lg px-4 py-2 text-sm font-medium border ${
              view === "evals" ? "border-white bg-white/10" : "border-white/10 bg-white/5 text-gray-400"
            }`}
          >
            Evals
          </button>
        </div>
      </div>

      {view === "usage" ? (
        <div className="space-y-10">
          {APPS.map((app) => (
            <AppSection key={app} appName={app} password={submitted} />
          ))}
        </div>
      ) : (
        <EvalsPerformance password={submitted} />
      )}
    </div>
  );
}

function AppSection({
  appName,
  password,
}: {
  appName: (typeof APPS)[number];
  password: string;
}) {
  const records = useQuery(api.usage.getUsageRecords, {
    dashboardPassword: password,
    appName,
    limit: 500,
  });

  if (records === undefined) return <div className="text-gray-500">Loading {appName}…</div>;

  const calls = records.length;
  const totalTokens = records.reduce((s, r) => s + r.totalTokens, 0);
  const avgLatency = calls ? records.reduce((s, r) => s + r.latencyMs, 0) / calls : 0;
  const failures = records.filter((r) => !r.success).length;

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-medium">{appName}</h2>
      <div className="grid grid-cols-4 gap-4">
        <Stat label="Calls" value={calls} />
        <Stat label="Total tokens" value={totalTokens.toLocaleString()} />
        <Stat label="Avg latency" value={`${avgLatency.toFixed(0)} ms`} />
        <Stat label="Failures" value={failures} />
      </div>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left border-b border-white/10 text-gray-400">
            <th className="py-2">Feature</th>
            <th>Model</th>
            <th>Tokens</th>
            <th>Latency</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          {records.slice(0, 20).map((r) => (
            <tr key={r._id} className="border-b border-white/5">
              <td className="py-2">{r.feature ?? "—"}</td>
              <td>{r.model}</td>
              <td>{r.totalTokens}</td>
              <td>{r.latencyMs} ms</td>
              <td>{new Date(r.createdAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
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

function EvalsPerformance({ password }: { password: string }) {
  const overallStats = useQuery(api.evals.getEvalStats, {
    dashboardPassword: password,
  });

  return (
    <div className="space-y-10">
      <div>
        <p className="text-gray-400 text-sm mb-4">
          Read-only performance view — human review happens in each app directly. This
          shows how well the LLM-as-judge is scoring outputs across apps.
        </p>
      </div>

      {overallStats === undefined && (
        <div className="text-gray-500 text-sm">Loading eval stats…</div>
      )}

      {overallStats && overallStats.total === 0 && (
        <div className="text-gray-600 text-sm italic">
          No evals recorded yet across any app.
        </div>
      )}

      {overallStats && overallStats.total > 0 && (
        <>
          <section className="space-y-4">
            <h2 className="text-lg font-medium">Overall</h2>
            <div className="grid grid-cols-4 gap-4">
              <Stat label="Total evals" value={overallStats.total} />
              <Stat label="Avg judge score" value={`${overallStats.avgJudgeScore.toFixed(1)} / 5`} />
              <Stat
                label="Human approval rate"
                value={
                  overallStats.humanReviewedCount > 0
                    ? `${Math.round(overallStats.humanApprovalRate * 100)}%`
                    : "—"
                }
              />
              <Stat
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
            <h2 className="text-lg font-medium">By app</h2>
            {Object.entries(overallStats.byApp).map(([app, data]) => (
              <div key={app} className="rounded-lg border border-white/10 p-5 space-y-4">
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
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}