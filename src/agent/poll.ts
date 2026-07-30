/**
 * Local polling agent — Sprint 2 + 3 + 4
 *
 * Polls the InboxEvent table for unprocessed events and, for each one:
 *   (a) gathers the last N ConversationLog records for that chat as context,
 *   (b) asks Gemini for a hypertrophy-coach reply (SKILL.md as systemInstruction,
 *       plus the learned StyleProfile summary if one exists),
 *   (c) executes any weight/calorie/workout logging Gemini decides to do
 *       (function calling — see src/agent/logging.ts),
 *   (d) sends the reply to the user via Telegram sendMessage,
 *   (e) writes both the user message and the reply to ConversationLog (memory),
 *   (f) marks the event processed=true.
 *
 * On a Gemini rate limit (429) or transient failure the event is left
 * processed=false and retried with exponential backoff. Errors are never
 * forwarded to the user — they only go to the console.
 *
 * AI provider: Google Gemini (NOT Anthropic/Claude).
 *
 * Usage:
 *   npx tsx src/agent/poll.ts        (or: npm run agent:poll)
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  generateCoachReply,
  GeminiRetryableError,
  type HistoryTurn,
} from "./gemini";
import { sendTelegramMessage } from "./telegram";
import { executeLoggingFunctionCall } from "./logging";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is not set");
}
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const POLL_INTERVAL_MS = 5_000;
const CONTEXT_MESSAGE_LIMIT = Number(process.env.CONTEXT_MESSAGE_LIMIT) || 20;

// Exponential backoff for retryable Gemini failures (per event).
const MAX_GEMINI_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 1_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Extracts the text of an incoming Telegram message from an InboxEvent payload. */
function extractMessageText(payload: unknown): string | null {
  const body = payload as Record<string, unknown> | null;
  const message =
    (body?.message as Record<string, unknown> | undefined) ??
    (body?.edited_message as Record<string, unknown> | undefined) ??
    (body?.channel_post as Record<string, unknown> | undefined);
  const text = message?.text;
  return typeof text === "string" && text.trim() ? text.trim() : null;
}

/** Loads the last N conversation turns for a chat, oldest first, as Gemini context. */
async function loadHistory(chatId: bigint): Promise<HistoryTurn[]> {
  const rows = await prisma.conversationLog.findMany({
    where: { chatId },
    orderBy: { createdAt: "desc" },
    take: CONTEXT_MESSAGE_LIMIT,
  });

  return rows
    .reverse()
    .map((row) => ({
      role: row.role === "assistant" ? "assistant" : "user",
      content: row.content,
    }));
}

/** Loads the learned StyleProfile summary (Sprint 4), if one has been generated yet. */
async function loadStyleProfileSummary(): Promise<string | null> {
  const profile = await prisma.styleProfile.findUnique({
    where: { id: "singleton" },
  });
  return profile ? JSON.stringify(profile.summary) : null;
}

/** Calls Gemini, retrying retryable failures with exponential backoff. */
async function generateWithBackoff(
  userMessage: string,
  history: HistoryTurn[],
  styleProfileSummary: string | null
): Promise<string> {
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      return await generateCoachReply(userMessage, history, {
        executeFunctionCall: (call) => executeLoggingFunctionCall(prisma, call),
        styleProfileSummary,
      });
    } catch (error) {
      const retryable = error instanceof GeminiRetryableError;
      if (!retryable || attempt >= MAX_GEMINI_ATTEMPTS) {
        throw error;
      }
      const delay = BASE_BACKOFF_MS * 2 ** (attempt - 1);
      console.warn(
        `[agent] Gemini retryable error (attempt ${attempt}/${MAX_GEMINI_ATTEMPTS}), ` +
          `backing off ${delay}ms: ${(error as Error).message}`
      );
      await sleep(delay);
    }
  }
}

type EventRow = Awaited<
  ReturnType<typeof prisma.inboxEvent.findMany>
>[number];

/**
 * Processes one event. Returns true if handled (event should be considered
 * done), or throws a GeminiRetryableError to signal a global back-off.
 */
async function processEvent(
  event: EventRow,
  styleProfileSummary: string | null
): Promise<void> {
  const text = extractMessageText(event.payload);

  // Non-text messages (photos, stickers, etc.) are out of scope this sprint.
  // Mark them processed so they don't clog the queue.
  if (!text) {
    await prisma.inboxEvent.update({
      where: { id: event.id },
      data: { processed: true, processedAt: new Date() },
    });
    console.log(`[agent] Event ${event.id}: no text, skipped.`);
    return;
  }

  console.log(
    `[agent] Event ${event.id} from chat ${event.chatId}: "${text.slice(0, 60)}"`
  );

  const history = await loadHistory(event.chatId);
  const reply = await generateWithBackoff(text, history, styleProfileSummary);

  // Send to the user first, so we only mark the event done once it's delivered.
  await sendTelegramMessage(event.chatId, reply);

  // Persist memory (user + assistant turns) and close the event atomically.
  await prisma.$transaction([
    prisma.conversationLog.create({
      data: { chatId: event.chatId, role: "user", content: text },
    }),
    prisma.conversationLog.create({
      data: { chatId: event.chatId, role: "assistant", content: reply },
    }),
    prisma.inboxEvent.update({
      where: { id: event.id },
      data: { processed: true, processedAt: new Date() },
    }),
  ]);

  console.log(`[agent] Event ${event.id}: replied & logged. ✅`);
}

async function pollUnprocessedEvents(): Promise<void> {
  const events = await prisma.inboxEvent.findMany({
    where: { processed: false },
    orderBy: { createdAt: "asc" },
    take: 10,
  });

  if (events.length === 0) {
    return;
  }

  // Loaded once per batch — freshness within a single 5s cycle doesn't matter.
  const styleProfileSummary = await loadStyleProfileSummary();

  for (const event of events) {
    try {
      await processEvent(event, styleProfileSummary);
    } catch (error) {
      if (error instanceof GeminiRetryableError) {
        // Rate limit / transient failure persisted through all retries.
        // Leave this (and remaining) events unprocessed and back off globally;
        // the next poll cycle will pick them up again.
        console.error(
          `[agent] Event ${event.id}: Gemini still failing after retries, ` +
            `leaving unprocessed. Backing off this cycle.`
        );
        break;
      }
      // Non-retryable error (e.g. Telegram/DB failure or bad request).
      // Leave the event unprocessed for the next cycle; do NOT leak to the user.
      console.error(`[agent] Event ${event.id}: failed, will retry.`, error);
    }
  }
}

async function main(): Promise<void> {
  console.log("🏋️ Antrenör Ajanı — Sprint 2+3+4 (Gemini + tracking + personalization)");
  console.log(`   Model:            ${process.env.GEMINI_MODEL || "gemini-flash-latest"}`);
  console.log(`   Context limit:    ${CONTEXT_MESSAGE_LIMIT} messages`);
  console.log(`   Polling interval: ${POLL_INTERVAL_MS / 1000}s`);
  console.log(`   Çıkmak için Ctrl+C\n`);

  await pollUnprocessedEvents();

  const interval = setInterval(async () => {
    try {
      await pollUnprocessedEvents();
    } catch (error) {
      console.error("❌ Polling error:", error);
    }
  }, POLL_INTERVAL_MS);

  const shutdown = async () => {
    console.log("\n🛑 Polling durduruluyor...");
    clearInterval(interval);
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
