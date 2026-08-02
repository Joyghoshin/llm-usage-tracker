import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";

const APPS = ["yatra-ai-next", "dalal-street-ai", "rootcause-ai"] as const;

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

  return <Dashboard password={submitted} onAuthError={() => setSubmitted("")} />;
}

function Dashboard({ password, onAuthError }: { password: string; onAuthError: () => void }) {
  return (
    <div className="max-w-5xl mx-auto px-6 py-10 space-y-10">
      <h1 className="text-2xl font-semibold">LLM Usage — YatraAI Next & DalalStreet AI</h1>
      {APPS.map((app) => (
        <AppSection key={app} appName={app} password={password} onAuthError={onAuthError} />
      ))}
    </div>
  );
}

function AppSection({
  appName,
  password,
  onAuthError,
}: {
  appName: (typeof APPS)[number];
  password: string;
  onAuthError: () => void;
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