import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * POST /api/telegram-webhook
 *
 * Receives Telegram bot updates via webhook.
 * Validates the secret token header, then stores
 * the raw update as an InboxEvent for later processing.
 */
export async function POST(request: NextRequest) {
  // --- 1. Validate webhook secret ---
  const secret = request.headers.get("x-telegram-bot-api-secret-token");
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (!expectedSecret) {
    console.error("[telegram-webhook] TELEGRAM_WEBHOOK_SECRET is not set");
    return NextResponse.json(
      { error: "Server misconfigured" },
      { status: 500 }
    );
  }

  if (secret !== expectedSecret) {
    console.warn("[telegram-webhook] Invalid secret token received");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // --- 2. Parse request body ---
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // --- 3. Extract Telegram message data ---
  const message =
    (body.message as Record<string, unknown> | undefined) ??
    (body.edited_message as Record<string, unknown> | undefined) ??
    (body.channel_post as Record<string, unknown> | undefined);

  if (!message) {
    // Telegram may send non-message updates (e.g. inline queries).
    // Acknowledge them but don't store.
    return NextResponse.json({ ok: true, skipped: true });
  }

  const chat = message.chat as Record<string, unknown> | undefined;
  const from = message.from as Record<string, unknown> | undefined;

  const chatId = chat?.id as number | undefined;
  const userId = from?.id as number | undefined;
  const username = from?.username as string | undefined;

  if (!chatId) {
    return NextResponse.json({ error: "No chat ID found" }, { status: 400 });
  }

  // --- 4. Store in InboxEvent queue ---
  try {
    const event = await prisma.inboxEvent.create({
      data: {
        source: "telegram",
        chatId: BigInt(chatId),
        userId: userId ? BigInt(userId) : null,
        username: username ?? null,
        payload: body as Prisma.InputJsonValue,
        processed: false,
      },
    });

    console.log(
      `[telegram-webhook] Stored InboxEvent ${event.id} from chat ${chatId}`
    );

    return NextResponse.json({ ok: true, eventId: event.id });
  } catch (error) {
    console.error("[telegram-webhook] Failed to store event:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/telegram-webhook
 * Health check — useful for verifying the route is live.
 */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "antrenor-ajani-telegram-webhook",
    timestamp: new Date().toISOString(),
  });
}
