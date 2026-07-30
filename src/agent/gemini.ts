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
import type { Content } from "@google/generative-ai";
import { loadCoachSkill } from "./skill";

const DEFAULT_MODEL = "gemini-flash-latest";

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
 * Generates the coach's reply for a single incoming message.
 *
 * @param userMessage the newest message from the user
 * @param history     previous turns (oldest first), used as memory/context
 * @returns the coach's reply text
 */
export async function generateCoachReply(
  userMessage: string,
  history: HistoryTurn[]
): Promise<string> {
  const model = getClient().getGenerativeModel({
    model: getModelName(),
    // The FULL SKILL.md is injected on every call so the coaching rules and the
    // hard steroid boundary (section 7) are enforced in every response.
    systemInstruction: loadCoachSkill(),
  });

  try {
    const chat = model.startChat({ history: toGeminiHistory(history) });
    const result = await chat.sendMessage(userMessage);
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
