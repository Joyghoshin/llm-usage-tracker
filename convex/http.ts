import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

const VALID_APPS = ["yatra-ai-next", "digital-twin", "skybot", "dalal-street-ai", "yatra-ai", "rootcause-ai", "pcmace-ai", "doubtmail-ai"] as const;

const JUDGE_MODEL = "nvidia/nemotron-3-super-120b-a12b";

function buildGenericJudgePrompt(question: string, context: string, reply: string) {
  return [
    "You are a strict examiner grading an AI assistant's reply for accuracy and quality.",
    "",
    "USER'S QUESTION:",
    question,
    "",
    context
      ? `LIVE DATA PROVIDED TO THE AI:\n${context}\n`
      : "LIVE DATA PROVIDED TO THE AI: (none for this message)\n",
    "AI'S REPLY:",
    reply,
    "",
    "Judge whether the reply is factually consistent with any live data provided, genuinely " +
      "helpful, and appropriately scoped. Penalize invented facts not present in the live data, " +
      "and unhelpful or off-topic replies.",
    "",
    "Respond with ONLY a single valid JSON object in this exact shape, nothing else:",
    JSON.stringify({
      score: "integer 1-5, 5 being excellent",
      verdict: "correct | partial | incorrect",
      reasoning: "one or two sentence justification",
    }),
  ].join("\n");
}

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

// ── /judgeEval ────────────────────────────────────────────────
// Runs the actual LLM-as-judge NVIDIA call server-side (from Convex's
// production cloud) instead of the caller doing it itself. Added for
// SkyBot: NVIDIA's API was returning a bare 404 to every judge-model
// request made directly from Render's free-tier IP range, even with a
// confirmed-working key/model/request shape (the same call succeeds
// from a local machine and from this Convex project's own production
// environment) — consistent with Render's shared IPs being blocked or
// rate-limited by NVIDIA. Routing the call through here sidesteps that
// entirely, and any other app can use this same endpoint if it hits
// the same problem.
http.route({
  path: "/judgeEval",
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
    if (typeof b.model !== "string" || typeof b.question !== "string" || typeof b.reply !== "string") {
      return new Response(
        JSON.stringify({ error: "model, question, and reply are required (strings)" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const nvidiaKey = process.env.NVIDIA_API_KEY;
    if (!nvidiaKey) {
      return new Response(
        JSON.stringify({ error: "Server misconfigured: NVIDIA_API_KEY not set on this Convex deployment" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const context = typeof b.context === "string" ? b.context : "";
    const taskType = typeof b.taskType === "string" ? b.taskType : undefined;
    const question = b.question as string;
    const reply = b.reply as string;
    const model = b.model as string;

    const prompt = buildGenericJudgePrompt(question, context, reply);
    const start = Date.now();

    let nvidiaResp: Response;
    try {
      nvidiaResp = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${nvidiaKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: JUDGE_MODEL,
          messages: [{ role: "user", content: prompt }],
          temperature: 0,
          max_tokens: 512,
          response_format: { type: "json_object" },
        }),
      });
    } catch (err) {
      return new Response(
        JSON.stringify({
          error: "Failed to reach NVIDIA",
          detail: err instanceof Error ? err.message : String(err),
        }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    const latencyMs = Date.now() - start;

    if (!nvidiaResp.ok) {
      const text = await nvidiaResp.text();
      return new Response(
        JSON.stringify({ error: `NVIDIA returned ${nvidiaResp.status}`, body: text.slice(0, 500) }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    const data = (await nvidiaResp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const rawContent = data.choices?.[0]?.message?.content || "{}";

    let parsed: { score?: number; verdict?: string; reasoning?: string };
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      parsed = { score: 0, verdict: "partial", reasoning: "" };
    }

    const verdict =
      parsed.verdict === "correct" || parsed.verdict === "partial" || parsed.verdict === "incorrect"
        ? parsed.verdict
        : "partial";
    const score = typeof parsed.score === "number" ? parsed.score : 0;
    const reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning : "";

    try {
      await ctx.runMutation(internal.evals.logEval, {
        appName: b.appName as typeof VALID_APPS[number],
        taskType,
        model,
        judgeModel: JUDGE_MODEL,
        judgeScore: score,
        judgeVerdict: verdict,
        judgeReasoning: reasoning,
      });
    } catch (err) {
      console.error("Failed to log eval from /judgeEval:", err);
    }

    try {
      await ctx.runMutation(internal.usage.logUsage, {
        appName: b.appName as typeof VALID_APPS[number],
        feature: "Judge Call",
        model: JUDGE_MODEL,
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
        latencyMs,
        success: true,
      });
    } catch (err) {
      console.error("Failed to log judge-call usage from /judgeEval:", err);
    }

    return new Response(JSON.stringify({ ok: true, score, verdict, reasoning }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

export default http;