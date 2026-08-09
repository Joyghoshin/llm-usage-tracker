import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const APP_NAMES = v.union(
  v.literal("yatra-ai-next"),
  v.literal("digital-twin"),
  v.literal("skybot"),
  v.literal("dalal-street-ai"),
  v.literal("yatra-ai"),
  v.literal("rootcause-ai"),
  v.literal("pcmace-ai")
);

export default defineSchema({
  llmUsage: defineTable({
    appName: APP_NAMES,
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

  // Central eval log — currently only rootcause-ai emits these, but any app
  // can start sending evals through the same /logEval endpoint later.
  evals: defineTable({
    appName: APP_NAMES,
    taskType: v.optional(v.string()), // e.g. "debug" | "improve" | "explain" — free-text since it may differ per app
    mode: v.optional(v.string()), // e.g. "fast" | "deep"
    model: v.string(),

    // LLM-as-judge
    judgeModel: v.string(),
    judgeScore: v.number(), // 1-5
    judgeVerdict: v.union(
      v.literal("correct"),
      v.literal("partial"),
      v.literal("incorrect")
    ),
    judgeReasoning: v.string(),

    // Human-in-the-loop, filled in later via the dashboard
    humanStatus: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("needs_edit")
    ),
    humanScore: v.optional(v.number()),
    humanNotes: v.optional(v.string()),
    reviewedBy: v.optional(v.string()),
    reviewedAt: v.optional(v.number()),

    createdAt: v.number(),
  })
    .index("by_appName", ["appName"])
    .index("by_humanStatus", ["humanStatus"])
    .index("by_appName_and_createdAt", ["appName", "createdAt"]),
});