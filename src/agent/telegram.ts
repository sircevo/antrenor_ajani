/**
 * Minimal Telegram Bot API client — just enough to send the coach's reply back
 * to the user. The outbound message goes directly from the (online) local agent,
 * so no outbox table is needed (see plan section 4.1).
 */

const TELEGRAM_API_BASE = "https://api.telegram.org";

/** Telegram rejects text messages longer than 4096 characters. */
const MAX_MESSAGE_LENGTH = 4096;

function getBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN environment variable is not set");
  }
  return token;
}

/** Splits an over-long reply into Telegram-sized chunks on line boundaries. */
function chunkText(text: string): string[] {
  if (text.length <= MAX_MESSAGE_LENGTH) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > MAX_MESSAGE_LENGTH) {
    let cut = remaining.lastIndexOf("\n", MAX_MESSAGE_LENGTH);
    if (cut <= 0) {
      cut = MAX_MESSAGE_LENGTH;
    }
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^\n/, "");
  }
  if (remaining) {
    chunks.push(remaining);
  }
  return chunks;
}

/**
 * Sends a plain-text message to a Telegram chat. Throws on API/network failure
 * so the caller can decide how to handle it (the error is never forwarded to
 * the user).
 */
export async function sendTelegramMessage(
  chatId: bigint | number,
  text: string
): Promise<void> {
  const token = getBotToken();
  const url = `${TELEGRAM_API_BASE}/bot${token}/sendMessage`;

  for (const chunk of chunkText(text)) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId.toString(),
        text: chunk,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Telegram sendMessage failed: ${response.status} ${detail}`
      );
    }
  }
}
