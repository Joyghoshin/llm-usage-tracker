import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";

// Records a single LLM call. Marked internal since the only caller is our
// own http.ts action (which does the actual authentication before
// forwarding here) - apps never call this directly.
export const logUsage = internalMutation({
  args: {
    appName: v.union(
      v.literal("yatra-ai-next"),
      v.literal("digital-twin"),
      v.literal("skybot"),
      v.literal("dalal-street-ai"),
      v.literal("yatra-ai"),
      v.literal("rootcause-ai"),
      v.literal("pcmace-ai"),
      v.literal("doubtmail-ai")
    ),
    feature: v.optional(v.string()),
    model: v.string(),
    promptTokens: v.number(),
    completionTokens: v.number(),
    totalTokens: v.number(),
    latencyMs: v.number(),
    success: v.boolean(),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("llmUsage", { ...args, createdAt: Date.now() });
  },
});

// Returns recent usage records for the dashboard. Gated by a simple shared
// password (checked against a Convex env var) rather than a full user/session
// system, since this is a single-user internal tool, not a multi-tenant app.
export const getUsageRecords = query({
  args: {
    dashboardPassword: v.string(),
    appName: v.optional(
      v.union(
        v.literal("yatra-ai-next"),
        v.literal("digital-twin"),
        v.literal("skybot"),
        v.literal("dalal-street-ai"),
        v.literal("yatra-ai"),
        v.literal("rootcause-ai"),
        v.literal("pcmace-ai"),
        v.literal("doubtmail-ai")
      )
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { dashboardPassword, appName, limit }) => {
    const expected = process.env.DASHBOARD_PASSWORD;
    if (!expected) {
      throw new Error("Convex is missing DASHBOARD_PASSWORD - run `npx convex env set DASHBOARD_PASSWORD=your_password`.");
    }
    if (dashboardPassword !== expected) {
      throw new Error("Incorrect dashboard password.");
    }

    const take = limit ?? 2000;

    if (appName) {
      return await ctx.db
        .query("llmUsage")
        .withIndex("by_appName_and_createdAt", (q) => q.eq("appName", appName))
        .order("desc")
        .take(take);
    }

    return await ctx.db.query("llmUsage").withIndex("by_createdAt").order("desc").take(take);
  },
});

// Aggregated token and cost data for charts, grouped by time bucket, app, and model
//
// Reads only the requested date window (using the createdAt index), newest first, and never more than
// MAX_ROWS_PER_CALL records, so one chart load cannot hit Convex's per-query read limits. When there
// is more data than that, `truncated` is true and the oldest records in the window are left out.
const MAX_ROWS_PER_CALL = 8000;

// Rough list prices in USD per 1M tokens. Models not listed use DEFAULT_PRICE_PER_M, so the cost
// numbers are estimates for comparing apps and models, not a bill.
const PRICE_PER_M: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4-turbo": { input: 10, output: 30 },
  "gpt-3.5-turbo": { input: 0.5, output: 1.5 },
  "claude-3-5-sonnet-20241022": { input: 3, output: 15 },
  "claude-3-5-haiku-20241022": { input: 0.8, output: 4 },
  "claude-3-opus-20240229": { input: 15, output: 75 },
  "gemini-1.5-pro": { input: 1.25, output: 5 },
  "gemini-1.5-flash": { input: 0.075, output: 0.3 },
};
const DEFAULT_PRICE_PER_M = { input: 1, output: 3 };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Totals = { inputTokens: number; outputTokens: number; cost: number; calls: number };

function bump<K>(map: Map<K, Totals>, key: K, input: number, output: number, cost: number) {
  const t = map.get(key) ?? { inputTokens: 0, outputTokens: 0, cost: 0, calls: 0 };
  t.inputTokens += input;
  t.outputTokens += output;
  t.cost += cost;
  t.calls += 1;
  map.set(key, t);
}

function bucketLabel(timestamp: number, bucket: "hour" | "day" | "week"): string {
  const d = new Date(timestamp); // UTC on purpose: the server has no user time zone
  const day = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return bucket === "hour" ? `${day} ${String(d.getUTCHours()).padStart(2, "0")}:00` : day;
}

const withTotals = (t: Totals) => ({ ...t, totalTokens: t.inputTokens + t.outputTokens });

export const getTokenCostAggregates = query({
  args: {
    dashboardPassword: v.string(),
    appName: v.optional(
      v.union(
        v.literal("yatra-ai-next"),
        v.literal("digital-twin"),
        v.literal("skybot"),
        v.literal("dalal-street-ai"),
        v.literal("yatra-ai"),
        v.literal("rootcause-ai"),
        v.literal("pcmace-ai"),
        v.literal("doubtmail-ai")
      )
    ),
    model: v.optional(v.string()),
    bucket: v.union(v.literal("hour"), v.literal("day"), v.literal("week")),
    startTime: v.optional(v.number()),
    endTime: v.optional(v.number()),
  },
  handler: async (ctx, { dashboardPassword, appName, model, bucket, startTime, endTime }) => {
    const expected = process.env.DASHBOARD_PASSWORD;
    if (!expected) {
      throw new Error("Convex is missing DASHBOARD_PASSWORD.");
    }
    if (dashboardPassword !== expected) {
      throw new Error("Incorrect dashboard password.");
    }

    const lo = startTime ?? 0;
    const hi = endTime ?? Number.MAX_SAFE_INTEGER;
    const base = appName
      ? ctx.db
          .query("llmUsage")
          .withIndex("by_appName_and_createdAt", (q) => q.eq("appName", appName).gte("createdAt", lo).lte("createdAt", hi))
      : ctx.db.query("llmUsage").withIndex("by_createdAt", (q) => q.gte("createdAt", lo).lte("createdAt", hi));

    const fetched = await base.order("desc").take(MAX_ROWS_PER_CALL + 1);
    const truncated = fetched.length > MAX_ROWS_PER_CALL;
    const rows = (truncated ? fetched.slice(0, MAX_ROWS_PER_CALL) : fetched).filter((r) => !model || r.model === model);

    const bucketMs = bucket === "hour" ? 3_600_000 : bucket === "day" ? 86_400_000 : 604_800_000;
    const byTime = new Map<number, Totals>();
    const byApp = new Map<string, Totals>();
    const byModel = new Map<string, Totals>();

    for (const r of rows) {
      const price = PRICE_PER_M[r.model] ?? DEFAULT_PRICE_PER_M;
      const cost = (r.promptTokens * price.input + r.completionTokens * price.output) / 1_000_000;
      bump(byTime, Math.floor(r.createdAt / bucketMs) * bucketMs, r.promptTokens, r.completionTokens, cost);
      bump(byApp, r.appName, r.promptTokens, r.completionTokens, cost);
      bump(byModel, r.model, r.promptTokens, r.completionTokens, cost);
    }

    const timeSeries = Array.from(byTime.entries())
      .sort(([a], [b]) => a - b)
      .map(([timestamp, t]) => ({ timestamp, label: bucketLabel(timestamp, bucket), ...withTotals(t) }));

    const appBreakdown = Array.from(byApp.entries())
      .map(([app, t]) => ({ app, ...withTotals(t) }))
      .sort((a, b) => b.cost - a.cost);

    const allModels = Array.from(byModel.entries())
      .map(([m, t]) => ({ model: m, ...withTotals(t) }))
      .sort((a, b) => b.cost - a.cost);
    const TOP_MODELS = 5;
    const rest = allModels.slice(TOP_MODELS);
    const modelBreakdown =
      rest.length > 0
        ? [
            ...allModels.slice(0, TOP_MODELS),
            {
              model: "Other",
              inputTokens: rest.reduce((s, m) => s + m.inputTokens, 0),
              outputTokens: rest.reduce((s, m) => s + m.outputTokens, 0),
              totalTokens: rest.reduce((s, m) => s + m.totalTokens, 0),
              cost: rest.reduce((s, m) => s + m.cost, 0),
              calls: rest.reduce((s, m) => s + m.calls, 0),
            },
          ]
        : allModels;

    return {
      timeSeries,
      appBreakdown,
      modelBreakdown,
      priceTable: PRICE_PER_M,
      defaultPrice: DEFAULT_PRICE_PER_M,
      truncated,
    };
  },
});