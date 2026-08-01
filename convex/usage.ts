import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";

export const logUsage = internalMutation({
  args: {
    appName: v.union(
      v.literal("yatra-ai-next"),
      v.literal("digital-twin"),
      v.literal("skybot"),
      v.literal("dalal-street-ai"),
      v.literal("yatra-ai")
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

export const getUsageRecords = query({
  args: {
    dashboardPassword: v.string(),
    appName: v.optional(
      v.union(
        v.literal("yatra-ai-next"),
        v.literal("digital-twin"),
        v.literal("skybot"),
        v.literal("dalal-street-ai"),
        v.literal("yatra-ai")
      )
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { dashboardPassword, appName, limit }) => {
    const expected = process.env.DASHBOARD_PASSWORD;
    if (!expected) {
      throw new Error("Convex is missing DASHBOARD_PASSWORD — run `npx convex env set DASHBOARD_PASSWORD=your_password`.");
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