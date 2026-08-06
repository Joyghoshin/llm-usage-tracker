import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

const VALID_APPS = ["yatra-ai-next", "digital-twin", "skybot", "dalal-street-ai", "yatra-ai", "rootcause-ai"] as const;

http.route({
  path: "/logUsage",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const providedSecret = request.headers.get("x-usage-secret");
    const expectedSecret = process.env.USAGE_LOG_SECRET;

    if (!expectedSecret) {
      return new Response(
        JSON.stringify({ error: "Server misconfigured: USAGE_LOG_SECRET not set" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
    if (providedSecret !== expectedSecret) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const b = body as Record<string, unknown>;

    if (typeof b.appName !== "string" || !(VALID_APPS as readonly string[]).includes(b.appName)) {
      return new Response(
        JSON.stringify({ error: `appName must be one of: ${VALID_APPS.join(", ")}` }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    if (typeof b.model !== "string") {
      return new Response(JSON.stringify({ error: "model is required (string)" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      await ctx.runMutation(internal.usage.logUsage, {
        appName: b.appName as typeof VALID_APPS[number],
        feature: typeof b.feature === "string" ? b.feature : undefined,
        model: b.model,
        promptTokens: typeof b.promptTokens === "number" ? b.promptTokens : 0,
        completionTokens: typeof b.completionTokens === "number" ? b.completionTokens : 0,
        totalTokens: typeof b.totalTokens === "number" ? b.totalTokens : 0,
        latencyMs: typeof b.latencyMs === "number" ? b.latencyMs : 0,
        success: typeof b.success === "boolean" ? b.success : true,
        errorMessage: typeof b.errorMessage === "string" ? b.errorMessage : undefined,
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: err instanceof Error ? err.message : "Failed to log usage" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

http.route({
  path: "/logEval",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const providedSecret = request.headers.get("x-usage-secret");
    const expectedSecret = process.env.USAGE_LOG_SECRET;

    if (!expectedSecret) {
      return new Response(
        JSON.stringify({ error: "Server misconfigured: USAGE_LOG_SECRET not set" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
    if (providedSecret !== expectedSecret) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const b = body as Record<string, unknown>;

    if (typeof b.appName !== "string" || !(VALID_APPS as readonly string[]).includes(b.appName)) {
      return new Response(
        JSON.stringify({ error: `appName must be one of: ${VALID_APPS.join(", ")}` }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    if (typeof b.model !== "string" || typeof b.judgeModel !== "string") {
      return new Response(
        JSON.stringify({ error: "model and judgeModel are required (string)" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    if (typeof b.judgeScore !== "number") {
      return new Response(JSON.stringify({ error: "judgeScore is required (number)" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    const validVerdicts = ["correct", "partial", "incorrect"];
    if (typeof b.judgeVerdict !== "string" || !validVerdicts.includes(b.judgeVerdict)) {
      return new Response(
        JSON.stringify({ error: `judgeVerdict must be one of: ${validVerdicts.join(", ")}` }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    try {
      await ctx.runMutation(internal.evals.logEval, {
        appName: b.appName as typeof VALID_APPS[number],
        taskType: typeof b.taskType === "string" ? b.taskType : undefined,
        mode: typeof b.mode === "string" ? b.mode : undefined,
        model: b.model,
        judgeModel: b.judgeModel,
        judgeScore: b.judgeScore,
        judgeVerdict: b.judgeVerdict as "correct" | "partial" | "incorrect",
        judgeReasoning: typeof b.judgeReasoning === "string" ? b.judgeReasoning : "",
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: err instanceof Error ? err.message : "Failed to log eval" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

export default http;