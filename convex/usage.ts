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

    let queryBuilder = ctx.db.query("llmUsage");

    if (appName) {
      queryBuilder = queryBuilder.withIndex("by_appName_and_createdAt", (q) => q.eq("appName", appName));
    } else {
      queryBuilder = queryBuilder.withIndex("by_createdAt");
    }

    if (startTime !== undefined) {
      queryBuilder = queryBuilder.filter((q) => q.gte(q.field("createdAt"), startTime));
    }
    if (endTime !== undefined) {
      queryBuilder = queryBuilder.filter((q) => q.lte(q.field("createdAt"), endTime));
    }

    const records = await queryBuilder.collect();

    let filtered = records;
    if (model) {
      filtered = filtered.filter((r) => r.model === model);
    }

    const bucketMs = bucket === "hour" ? 3600000 : bucket === "day" ? 86400000 : 604800000;
    const now = Date.now();
    const defaultStart = now - 30 * 86400000;
    const start = startTime ?? defaultStart;
    const end = endTime ?? now;

    const buckets: Map<number, { inputTokens: number; outputTokens: number; cost: number; calls: number }> = new Map();
    const byApp: Map<string, { inputTokens: number; outputTokens: number; cost: number; calls: number }> = new Map();
    const byModel: Map<string, { inputTokens: number; outputTokens: number; cost: number; calls: number }> = new Map();

    const priceTable: Record<string, { input: number; output: number }> = {
      "gpt-4o": { input: 2.50 / 1_000_000, output: 10.00 / 1_000_000 },
      "gpt-4o-mini": { input: 0.15 / 1_000_000, output: 0.60 / 1_000_000 },
      "gpt-4-turbo": { input: 10.00 / 1_000_000, output: 30.00 / 1_000_000 },
      "gpt-3.5-turbo": { input: 0.50 / 1_000_000, output: 1.50 / 1_000_000 },
      "claude-3-5-sonnet-20241022": { input: 3.00 / 1_000_000, output: 15.00 / 1_000_000 },
      "claude-3-5-haiku-20241022": { input: 0.80 / 1_000_000, output: 4.00 / 1_000_000 },
      "claude-3-opus-20240229": { input: 15.00 / 1_000_000, output: 75.00 / 1_000_000 },
      "gemini-1.5-pro": { input: 1.25 / 1_000_000, output: 5.00 / 1_000_000 },
      "gemini-1.5-flash": { input: 0.075 / 1_000_000, output: 0.30 / 1_000_000 },
    };

    const defaultPrice = { input: 1.00 / 1_000_000, output: 3.00 / 1_000_000 };

    for (const r of filtered) {
      const bucketKey = Math.floor(r.createdAt / bucketMs) * bucketMs;
      const existing = buckets.get(bucketKey) ?? { inputTokens: 0, outputTokens: 0, cost: 0, calls: 0 };
      existing.inputTokens += r.promptTokens;
      existing.outputTokens += r.completionTokens;
      existing.calls += 1;

      const prices = priceTable[r.model] ?? defaultPrice;
      existing.cost += (r.promptTokens * prices.input) + (r.completionTokens * prices.output);
      buckets.set(bucketKey, existing);

      const appKey = r.appName;
      const appExisting = byApp.get(appKey) ?? { inputTokens: 0, outputTokens: 0, cost: 0, calls: 0 };
      appExisting.inputTokens += r.promptTokens;
      appExisting.outputTokens += r.completionTokens;
      appExisting.calls += 1;
      appExisting.cost += (r.promptTokens * prices.input) + (r.completionTokens * prices.output);
      byApp.set(appKey, appExisting);

      const modelKey = r.model;
      const modelExisting = byModel.get(modelKey) ?? { inputTokens: 0, outputTokens: 0, cost: 0, calls: 0 };
      modelExisting.inputTokens += r.promptTokens;
      modelExisting.outputTokens += r.completionTokens;
      modelExisting.calls += 1;
      modelExisting.cost += (r.promptTokens * prices.input) + (r.completionTokens * prices.output);
      byModel.set(modelKey, modelExisting);
    }

    const timeSeries = Array.from(buckets.entries())
      .sort(([a], [b]) => a - b)
      .map(([timestamp, data]) => ({
        timestamp,
        label: new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: bucket === "hour" ? "2-digit" : undefined }),
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
        totalTokens: data.inputTokens + data.outputTokens,
        cost: data.cost,
        calls: data.calls,
      }));

    const appBreakdown = Array.from(byApp.entries())
      .map(([app, data]) => ({
        app,
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
        totalTokens: data.inputTokens + data.outputTokens,
        cost: data.cost,
        calls: data.calls,
      }))
      .sort((a, b) => b.cost - a.cost);

    const modelBreakdown = Array.from(byModel.entries())
      .map(([model, data]) => ({
        model,
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
        totalTokens: data.inputTokens + data.outputTokens,
        cost: data.cost,
        calls: data.calls,
      }))
      .sort((a, b) => b.cost - a.cost);

    const topN = 5;
    const topModels = modelBreakdown.slice(0, topN);
    const otherModels = modelBreakdown.slice(topN);
    const otherCost = otherModels.reduce((s, m) => s + m.cost, 0);
    const otherInputTokens = otherModels.reduce((s, m) => s + m.inputTokens, 0);
    const otherOutputTokens = otherModels.reduce((s, m) => s + m.outputTokens, 0);
    const otherCalls = otherModels.reduce((s, m) => s + m.calls, 0);

    const modelBreakdownWithOther = otherModels.length > 0
      ? [...topModels, { model: "Other", inputTokens: otherInputTokens, outputTokens: otherOutputTokens, totalTokens: otherInputTokens + otherOutputTokens, cost: otherCost, calls: otherCalls }]
      : topModels;

    return {
      timeSeries,
      appBreakdown,
      modelBreakdown: modelBreakdownWithOther,
      priceTable: Object.fromEntries(
        Object.entries(priceTable).map(([model, prices]) => [model, { input: prices.input * 1_000_000, output: prices.output * 1_000_000 }])
      ),
      defaultPrice: { input: defaultPrice.input * 1_000_000, output: defaultPrice.output * 1_000_000 },
    };
  },
});
