/**
 * Local polling agent — Sprint 1
 *
 * Polls the InboxEvent table every 5 seconds for unprocessed events.
 * Logs them to the console and marks them as processed.
 *
 * Usage:
 *   npx tsx src/agent/poll.ts
 *
 * In Sprint 2+ this will be replaced with Claude API processing.
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is not set");
}
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const POLL_INTERVAL_MS = 5_000;

async function pollUnprocessedEvents(): Promise<void> {
  const events = await prisma.inboxEvent.findMany({
    where: { processed: false },
    orderBy: { createdAt: "asc" },
    take: 10,
  });

  if (events.length === 0) {
    return;
  }

  console.log(`\n📨 Found ${events.length} unprocessed event(s):\n`);

  for (const event of events) {
    const payload = event.payload as Record<string, unknown>;
    const message = payload.message as Record<string, unknown> | undefined;
    const text = message?.text ?? "(no text)";

    console.log(`  ─────────────────────────────────────`);
    console.log(`  ID:       ${event.id}`);
    console.log(`  Source:   ${event.source}`);
    console.log(`  Chat ID:  ${event.chatId}`);
    console.log(`  User:     ${event.username ?? "unknown"}`);
    console.log(`  Text:     ${text}`);
    console.log(`  Time:     ${event.createdAt.toISOString()}`);

    // Mark as processed
    await prisma.inboxEvent.update({
      where: { id: event.id },
      data: {
        processed: true,
        processedAt: new Date(),
      },
    });

    console.log(`  Status:   ✅ Marked as processed`);
  }
}

async function main(): Promise<void> {
  console.log("🏋️ Antrenör Ajanı — Kuyruk Polling Başlatıldı");
  console.log(`   Polling interval: ${POLL_INTERVAL_MS / 1000}s`);
  console.log(`   Çıkmak için Ctrl+C\n`);

  // Initial poll
  await pollUnprocessedEvents();

  // Recurring poll
  const interval = setInterval(async () => {
    try {
      await pollUnprocessedEvents();
    } catch (error) {
      console.error("❌ Polling error:", error);
    }
  }, POLL_INTERVAL_MS);

  // Graceful shutdown
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
