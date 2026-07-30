/**
 * Gemini client for the coach agent.
 *
 * Provider: Google Gemini (NOT Anthropic/Claude).
 * Package:  @google/generative-ai
 * Model:    read from GEMINI_MODEL (default gemini-2.5-flash) so it can be
 *           swapped from a single place later.
 *
 * The API key is read from GEMINI_API_KEY and is never logged.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Content, FunctionCall, Part } from "@google/generative-ai";
import { loadCoachSkill } from "./skill";
import { loggingToolDeclarations } from "./logging";

const DEFAULT_MODEL = "gemini-flash-latest";

// Agent plumbing instructions — NOT part of the user-owned SKILL.md coaching
// philosophy. Explains when/why to use the logging tools.
const TOOL_USAGE_INSTRUCTIONS = `
## Kayıt araçları (log_weight, log_calorie_entry, log_workout)

Kullanıcı geçmişte fiilen yaptığı bir şeyi (kilo ölçümü, yediği bir şey, tamamladığı bir antrenman)
bildirdiğinde ilgili aracı çağırarak veritabanına kaydet. Kullanıcı bir öneri/plan/tavsiye
İSTİYORSA (ör. "bugün ne yapayım", "ne yemeliyim") bu araçları ÇAĞIRMA — sadece cevapla.
Bir mesajda birden fazla kayıt olabilir (ör. kilo + öğün aynı mesajda); hepsini ayrı ayrı çağır.
Kayıt sonrası cevabında, aracın döndürdüğü bilgiyi (önceki değer, fark, tahmin olup olmadığı gibi)
doğal bir şekilde kullanıcıya yansıt.
`.trim();

// Function-calling can loop (call → respond → model calls again); cap to avoid runaway loops.
const MAX_FUNCTION_CALL_ROUNDS = 5;

/** Executes one Gemini function call and returns its FunctionResponse payload. */
export type FunctionCallExecutor = (
  call: FunctionCall
) => Promise<{ name: string; response: Record<string, unknown> }>;

export interface GenerateCoachReplyOptions {
  /** Executes logging tool calls (weight/calorie/workout) against the DB. */
  executeFunctionCall: FunctionCallExecutor;
  /** Learned tone/preference summary (StyleProfile), injected if present. */
  styleProfileSummary?: string | null;
}

/** One turn of stored conversation history. */
export interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * Raised when Gemini signals rate limiting / quota (HTTP 429) or a transient
 * server error (5xx). The poll loop uses this to decide whether to retry the
 * event later instead of marking it processed.
 */
export class GeminiRetryableError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "GeminiRetryableError";
  }
}

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("GEMINI_API_KEY environment variable is not set");
  }
  return key;
}

function getModelName(): string {
  return process.env.GEMINI_MODEL || DEFAULT_MODEL;
}

let client: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  if (!client) {
    client = new GoogleGenerativeAI(getApiKey());
  }
  return client;
}

/**
 * Gemini uses "user" / "model" roles. Map our stored "assistant" role onto
 * "model" and pass everything else through as "user".
 */
function toGeminiHistory(history: HistoryTurn[]): Content[] {
  return history.map((turn) => ({
    role: turn.role === "assistant" ? "model" : "user",
    parts: [{ text: turn.content }],
  }));
}

/** Detects HTTP status codes embedded in the SDK's thrown error messages. */
function extractStatus(error: unknown): number | undefined {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/\[(\d{3})[^\]]*\]|status[^0-9]*(\d{3})/i);
  const code = match?.[1] ?? match?.[2];
  return code ? Number(code) : undefined;
}

/**
 * Generates the coach's reply for a single incoming message. If Gemini decides
 * to log structured data (weight/calories/workout) via function calling, this
 * executes those calls through `opts.executeFunctionCall` and continues the
 * exchange until the model produces its final natural-language reply.
 *
 * @param userMessage the newest message from the user
 * @param history     previous turns (oldest first), used as memory/context
 * @returns the coach's reply text
 */
export async function generateCoachReply(
  userMessage: string,
  history: HistoryTurn[],
  opts: GenerateCoachReplyOptions
): Promise<string> {
  const systemInstruction = opts.styleProfileSummary
    ? `${loadCoachSkill()}\n\n${TOOL_USAGE_INSTRUCTIONS}\n\n## Kullanıcı hakkında öğrenilenler\n${opts.styleProfileSummary}`
    : `${loadCoachSkill()}\n\n${TOOL_USAGE_INSTRUCTIONS}`;

  const model = getClient().getGenerativeModel({
    model: getModelName(),
    // The FULL SKILL.md is injected on every call so the coaching rules and the
    // hard steroid boundary (section 7) are enforced in every response.
    systemInstruction,
    tools: [{ functionDeclarations: loggingToolDeclarations }],
  });

  try {
    // NOTE: we deliberately do NOT use model.startChat()/ChatSession here.
    // ChatSession.sendMessage() hardcodes role "function" for function-response
    // turns, which current-generation models reject (only "user"/"model" are
    // valid roles now). Instead we manage `contents` ourselves and append the
    // model's own returned `content` object verbatim before continuing — this
    // also transparently round-trips any opaque fields newer models attach to
    // function-call parts (e.g. thought signatures) without us needing to know
    // about them.
    const contents: Content[] = [
      ...toGeminiHistory(history),
      { role: "user", parts: [{ text: userMessage }] },
    ];

    let result = await model.generateContent({ contents });

    for (let round = 0; round < MAX_FUNCTION_CALL_ROUNDS; round++) {
      const calls = result.response.functionCalls();
      if (!calls || calls.length === 0) {
        break;
      }

      const modelContent = result.response.candidates?.[0]?.content;
      if (modelContent) {
        contents.push(modelContent);
      }

      const responseParts: Part[] = [];
      for (const call of calls) {
        const { name, response } = await opts.executeFunctionCall(call);
        responseParts.push({ functionResponse: { name, response } });
      }
      contents.push({ role: "user", parts: responseParts });

      result = await model.generateContent({ contents });
    }

    const text = result.response.text().trim();

    if (!text) {
      // Empty output (e.g. safety block) — retry later rather than send blank.
      throw new GeminiRetryableError("Gemini returned an empty response");
    }
    return text;
  } catch (error) {
    if (error instanceof GeminiRetryableError) {
      throw error;
    }

    const status = extractStatus(error);
    // 429 = rate limit / quota, 5xx = transient server error → retryable.
    if (status === 429 || (status !== undefined && status >= 500)) {
      throw new GeminiRetryableError(
        `Gemini request failed with status ${status}`,
        status
      );
    }
    // Anything else (bad request, auth, etc.) is not retryable — rethrow.
    throw error;
  }
}
