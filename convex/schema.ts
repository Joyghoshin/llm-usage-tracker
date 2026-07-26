import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  llmUsage: defineTable({
    // Which of your four apps this call came from — the key addition vs.
    // Yatra AI Next's original schema, since this table now aggregates
    // across all of them instead of living inside a single app.
    appName: v.union(
      v.literal("yatra-ai-next"),
      v.literal("digital-twin"),
      v.literal("skybot"),
      v.literal("dalal-street-ai")
    ),
    // Optional free-text label for what the call was for within that app
    // (e.g. "generateItinerary", "chat", "flightFareRules") — not a strict
    // enum here since each app's features differ; the dashboard can still
    // group/filter by whatever strings actually show up.
    feature: v.optional(v.string()),
    model: v.string(),
    promptTokens: v.number(),
    completionTokens: v.number(),
    totalTokens: v.number(),
    latencyMs: v.number(),
    success: v.boolean(),
    errorMessage: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_appName", ["appName"])
    .index("by_createdAt", ["createdAt"])
    .index("by_appName_and_createdAt", ["appName", "createdAt"]),
});