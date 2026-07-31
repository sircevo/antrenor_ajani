import { prisma } from "@/lib/db";
import { ChatClient, type ChatMessage } from "./ChatClient";
import styles from "./chat.module.css";

// Reads conversation rows written by this route's own POST handler.
export const dynamic = "force-dynamic";

const WEB_CHAT_ID = BigInt(0);
const HISTORY_LIMIT = 50;

export default async function ChatPage() {
  const rows = await prisma.conversationLog.findMany({
    where: { chatId: WEB_CHAT_ID },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
  });

  const initialMessages: ChatMessage[] = rows.reverse().map((row) => ({
    role: row.role === "assistant" ? "assistant" : "user",
    content: row.content,
  }));

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1>Antrenör</h1>
      </header>
      <ChatClient initialMessages={initialMessages} />
    </main>
  );
}
