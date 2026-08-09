import { internalMutation, mutation, query } from "./_generated/server";
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

// Records a single eval. Only caller is http.ts's /logEval action, which
// authenticates via the shared secret before forwarding here.
export const logEval = internalMutation({
  args: {
    appName: APP_NAMES,
    taskType: v.optional(v.string()),
    mode: v.optional(v.string()),
    model: v.string(),
    judgeModel: v.string(),
    judgeScore: v.number(),
    judgeVerdict: v.union(
      v.literal("correct"),
      v.literal("partial"),
      v.literal("incorrect")
    ),
    judgeReasoning: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("evals", {
      ...args,
      humanStatus: "pending",
      createdAt: Date.now(),
    });
  },
});

// Human review submission — called directly from the dashboard (password-gated
// at the query level below; this mutation itself just needs a valid evalId).
export const submitHumanReview = mutation({
  args: {
    evalId: v.id("evals"),
    dashboardPassword: v.string(),
    humanStatus: v.union(
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("needs_edit")
    ),
    humanScore: v.optional(v.number()),
    humanNotes: v.optional(v.string()),
    reviewedBy: v.string(),
  },
  handler: async (ctx, args) => {
    const expected = process.env.DASHBOARD_PASSWORD;
    if (!expected) {
      throw new Error("Convex is missing DASHBOARD_PASSWORD.");
    }
    if (args.dashboardPassword !== expected) {
      throw new Error("Incorrect dashboard password.");
    }

    await ctx.db.patch(args.evalId, {
      humanStatus: args.humanStatus,
      humanScore: args.humanScore,
      humanNotes: args.humanNotes,
      reviewedBy: args.reviewedBy,
      reviewedAt: Date.now(),
    });
  },
});

// Raw list for the review table — same password-gate pattern as getUsageRecords.
export const getEvalRecords = query({
  args: {
    dashboardPassword: v.string(),
    appName: v.optional(APP_NAMES),
    humanStatus: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("approved"),
        v.literal("rejected"),
        v.literal("needs_edit")
      )
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { dashboardPassword, appName, humanStatus, limit }) => {
    const expected = process.env.DASHBOARD_PASSWORD;
    if (!expected) {
      throw new Error("Convex is missing DASHBOARD_PASSWORD.");
    }
    if (dashboardPassword !== expected) {
      throw new Error("Incorrect dashboard password.");
    }

    const take = limit ?? 500;

    let results;
    if (appName) {
      results = await ctx.db
        .query("evals")
        .withIndex("by_appName_and_createdAt", (q) => q.eq("appName", appName))
        .order("desc")
        .take(take);
    } else {
      results = await ctx.db.query("evals").withIndex("by_appName").order("desc").take(take);
    }

    if (humanStatus) {
      results = results.filter((e) => e.humanStatus === humanStatus);
    }
    return results;
  },
});

// Aggregate stats for the dashboard summary cards — same password gate.
export const getEvalStats = query({
  args: {
    dashboardPassword: v.string(),
    appName: v.optional(APP_NAMES),
  },
  handler: async (ctx, { dashboardPassword, appName }) => {
    const expected = process.env.DASHBOARD_PASSWORD;
    if (!expected) {
      throw new Error("Convex is missing DASHBOARD_PASSWORD.");
    }
    if (dashboardPassword !== expected) {
      throw new Error("Incorrect dashboard password.");
    }

    const evals = appName
      ? await ctx.db
          .query("evals")
          .withIndex("by_appName_and_createdAt", (q) => q.eq("appName", appName))
          .collect()
      : await ctx.db.query("evals").collect();

    const total = evals.length;
    if (total === 0) {
      return {
        total: 0,
        avgJudgeScore: 0,
        humanReviewedCount: 0,
        humanApprovalRate: 0,
        judgeHumanAgreementRate: 0,
        verdictBreakdown: { correct: 0, partial: 0, incorrect: 0 },
        byApp: {},
      };
    }

    const avgJudgeScore = evals.reduce((s, e) => s + e.judgeScore, 0) / total;

    const humanReviewed = evals.filter((e) => e.humanStatus !== "pending");
    const humanApproved = evals.filter((e) => e.humanStatus === "approved");
    const humanApprovalRate =
      humanReviewed.length > 0 ? humanApproved.length / humanReviewed.length : 0;

    const agreements = humanReviewed.filter((e) => {
      if (e.judgeVerdict === "correct") return e.humanStatus === "approved";
      if (e.judgeVerdict === "incorrect") return e.humanStatus === "rejected";
      return e.humanStatus === "needs_edit";
    });
    const judgeHumanAgreementRate =
      humanReviewed.length > 0 ? agreements.length / humanReviewed.length : 0;

    const verdictBreakdown = {
      correct: evals.filter((e) => e.judgeVerdict === "correct").length,
      partial: evals.filter((e) => e.judgeVerdict === "partial").length,
      incorrect: evals.filter((e) => e.judgeVerdict === "incorrect").length,
    };

    type AppStats = {
      count: number;
      avgScore: number;
      verdictBreakdown: { correct: number; partial: number; incorrect: number };
      humanReviewedCount: number;
      humanApprovalRate: number;
    };

    const byApp: Record<string, AppStats> = {};

    const appNames = Array.from(new Set(evals.map((e) => e.appName)));
    for (const app of appNames) {
      const subset = evals.filter((e) => e.appName === app);
      const subsetHumanReviewed = subset.filter((e) => e.humanStatus !== "pending");
      const subsetApproved = subset.filter((e) => e.humanStatus === "approved");

      byApp[app] = {
        count: subset.length,
        avgScore: subset.reduce((s, e) => s + e.judgeScore, 0) / subset.length,
        verdictBreakdown: {
          correct: subset.filter((e) => e.judgeVerdict === "correct").length,
          partial: subset.filter((e) => e.judgeVerdict === "partial").length,
          incorrect: subset.filter((e) => e.judgeVerdict === "incorrect").length,
        },
        humanReviewedCount: subsetHumanReviewed.length,
        humanApprovalRate:
          subsetHumanReviewed.length > 0 ? subsetApproved.length / subsetHumanReviewed.length : 0,
      };
    }

    return {
      total,
      avgJudgeScore,
      humanReviewedCount: humanReviewed.length,
      humanApprovalRate,
      judgeHumanAgreementRate,
      verdictBreakdown,
      byApp,
    };
  },
});