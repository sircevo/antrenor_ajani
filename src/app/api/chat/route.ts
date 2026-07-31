import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { generateCoachReply, type HistoryTurn } from "@/agent/kimi";
import { executeLoggingFunctionCall } from "@/agent/logging";
import { buildLiveContext } from "@/agent/context";

// Single-user app: all web chat shares one conversation thread. BigInt 0 marks
// the web channel, distinct from any real Telegram chat id.
const WEB_CHAT_ID = BigInt(0);

const CONTEXT_MESSAGE_LIMIT = Number(process.env.CONTEXT_MESSAGE_LIMIT) || 20;

/** Loads the last N turns for the web thread, oldest first. */
async function loadHistory(): Promise<HistoryTurn[]> {
  const rows = await prisma.conversationLog.findMany({
    where: { chatId: WEB_CHAT_ID },
    orderBy: { createdAt: "desc" },
    take: CONTEXT_MESSAGE_LIMIT,
  });

  return rows.reverse().map((row) => ({
    role: row.role === "assistant" ? ("assistant" as const) : ("user" as const),
    content: row.content,
  }));
}

/**
 * POST /api/chat — one message in, one reply out.
 *
 * Replaces the old Telegram polling agent: because this is synchronous there
 * is no background loop that can overlap itself and answer the same message
 * twice.
 */
export async function POST(request: NextRequest) {
  let message: string;
  try {
    const body = await request.json();
    message = typeof body?.message === "string" ? body.message.trim() : "";
  } catch {
    return NextResponse.json({ error: "Geçersiz istek" }, { status: 400 });
  }

  if (!message) {
    return NextResponse.json({ error: "Mesaj boş olamaz" }, { status: 400 });
  }

  try {
    const [history, profile, liveContext] = await Promise.all([
      loadHistory(),
      prisma.styleProfile.findUnique({ where: { id: "singleton" } }),
      buildLiveContext(prisma),
    ]);

    const reply = await generateCoachReply(message, history, {
      executeFunctionCall: (call) => executeLoggingFunctionCall(prisma, call),
      styleProfileSummary: profile ? JSON.stringify(profile.summary) : null,
      tone: profile?.tone ?? null,
      needsOnboarding: !profile?.onboarded,
      liveContext,
    });

    // Store the user's own words — the live-context block is regenerated per
    // request and must not accumulate in history.
    await prisma.$transaction([
      prisma.conversationLog.create({
        data: { chatId: WEB_CHAT_ID, role: "user", content: message },
      }),
      prisma.conversationLog.create({
        data: { chatId: WEB_CHAT_ID, role: "assistant", content: reply },
      }),
    ]);

    // A reply may have written weight/calorie/plan rows via tools. Drop the
    // router cache for the pages that read them, so switching tabs right after
    // a change shows the new state instead of a ~30s-stale copy.
    revalidatePath("/");
    revalidatePath("/takvim");
    revalidatePath("/ilerleme");

    return NextResponse.json({ reply });
  } catch (error) {
    // Provider/DB details stay server-side; the user gets a generic message.
    console.error("[chat] Failed to generate reply:", error);
    return NextResponse.json(
      { error: "Şu an cevap veremiyorum, birazdan tekrar dener misin?" },
      { status: 503 }
    );
  }
}
