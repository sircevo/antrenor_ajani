/**
 * Coach model provider — Kimi K2.6 (Moonshot AI).
 *
 * The API is OpenAI-compatible, so we use the `openai` client pointed at
 * Moonshot's base URL. Model id comes from KIMI_MODEL so it can be swapped
 * from one place; the API key is read from KIMI_API_KEY and never logged.
 *
 * K2.6 over K3: ~4x cheaper ($0.95/$4.00 vs $3/$15 per MTok) and, with
 * reasoning disabled, measured as reliable on tool-calling in testing (6/6 vs
 * K3's ~70-80%). K3 is a heavier model than a single-user coaching chat needs.
 */

import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import type { ReasoningEffort } from "openai/resources/shared";
import { loadCoachSkill } from "./skill";
import { loggingToolDeclarations, type ParsedToolCall } from "./logging";
import { ONBOARDING_INSTRUCTIONS, toneInstruction } from "./onboarding";

const BASE_URL = "https://api.moonshot.ai/v1";
const DEFAULT_MODEL = "kimi-k2.6";

/**
 * Caps a runaway reply. This is a CEILING, not a spend: a short coaching answer
 * still bills only the tokens it actually produces, so a generous limit costs
 * nothing on ordinary turns.
 *
 * It was 1500, which silently strangled programming. Measured on a full request
 * ("7 günlük program + beslenme hedefleri", 84 kg enhanced lifter): the
 * create_workout_plan tool call alone needs ~1440 output tokens — right at the
 * old ceiling. The model would emit a truncated JSON payload, fail to parse,
 * retry, and burn all MAX_FUNCTION_CALL_ROUNDS without ever writing a plan,
 * leaving the calendar empty. With the ceiling raised the same model (reasoning
 * still disabled) produces a 7-day, 38-exercise, 136-set week with technique
 * notes on every movement.
 *
 * Keep headroom for a 14-day plan (~2x) plus the accompanying reply text. Note
 * this budget also covers K3's internal reasoning tokens, not just visible text.
 */
const MAX_REPLY_TOKENS = 8000;

/**
 * K3 "thinks" before answering and bills those reasoning tokens as output
 * ($15/M). Measured on a one-sentence coaching question: default effort burned
 * ~298 reasoning tokens vs ~9 at "minimal", for the same answer. Coaching turns
 * don't need deep deliberation, so default to minimal and leave it tunable.
 */
const DEFAULT_REASONING_EFFORT: ReasoningEffort = "minimal";

const VALID_EFFORTS: ReasoningEffort[] = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
];

function getReasoningEffort(): ReasoningEffort {
  const configured = process.env.KIMI_REASONING_EFFORT as ReasoningEffort | undefined;
  return configured && VALID_EFFORTS.includes(configured)
    ? configured
    : DEFAULT_REASONING_EFFORT;
}

/**
 * K2-family models (e.g. kimi-k2.6) don't honor `reasoning_effort` the way K3
 * does — measured ~700 reasoning tokens regardless of effort level. They use a
 * separate, undocumented-in-the-OpenAI-types `thinking` object instead; probed
 * empirically: `{type: "disabled"}` drops reasoning tokens to ~1.
 */
function isK2Family(model: string): boolean {
  return model.startsWith("kimi-k2");
}

/** Moonshot-specific request extension not present in the OpenAI SDK's types. */
interface ThinkingParam {
  thinking?: { type: "disabled" | "enabled" };
}

// Function-calling can loop (call → respond → model calls again); cap it.
const MAX_FUNCTION_CALL_ROUNDS = 5;

// Keeps the agent inside its domain. Static, so it stays in the cached prefix.
const SCOPE_INSTRUCTIONS = `
## Konu sınırı

Sen bu uygulamanın antrenörüsün, genel amaçlı bir asistan DEĞİLSİN.
Yalnızca şu konularda cevap ver:
- antrenman, programlama, hareket tekniği
- beslenme, kalori, makro, öğün planı
- toparlanma, uyku, takviye ve vitamin zamanlaması
- vücut ölçümleri, kilo, ilerleme takibi
- sakatlık/ağrı (SKILL.md'deki yönlendirme kurallarına uyarak)
- uygulamanın kendi kullanımı (kayıt girme, takvim, hedefler)

Bunların dışındaki HİÇBİR soruyu cevaplama: genel kültür, araba, teknoloji, kod,
haber, siyaset, alışveriş, tarih, çeviri, matematik ödevi vb. Böyle bir soru
gelirse tek cümlelik, seçtiğin tondaki kibar bir hatırlatmayla geri çevir ve
antrenman/beslenme konusuna dön. Konu dışı soruya kısmen bile cevap verme,
"ama kısaca şöyle" diye ekleme yapma, bildiğini göstermeye çalışma.

Sınırda kalan durumlar KONU İÇİDİR, cevapla: seyahatte/otel spor salonunda
antrenman, dışarıda yemek seçimi, iş temposunun uykuya ve toparlanmaya etkisi,
ekipman alternatifleri gibi doğrudan antrenman veya beslenmeyi etkileyen sorular.
`.trim();

// Agent plumbing instructions — NOT part of the user-owned SKILL.md coaching
// philosophy. Explains when/why to use the recording tools, and sets the
// response-length expectation the user asked for.
const TOOL_USAGE_INSTRUCTIONS = `
## Kayıt araçları (log_weight, log_calorie_entry, log_workout)

Kullanıcı geçmişte fiilen yaptığı bir şeyi (kilo ölçümü, yediği bir şey, tamamladığı bir antrenman)
bildirdiğinde ilgili aracı çağırarak veritabanına kaydet. Kullanıcı bir öneri/plan/tavsiye
İSTİYORSA (ör. "bugün ne yapayım", "ne yemeliyim") bu araçları ÇAĞIRMA — sadece cevapla.
Bir mesajda birden fazla kayıt olabilir; hepsini ayrı ayrı çağır.
Kayıt sonrası cevabında, aracın döndürdüğü bilgiyi (önceki değer, fark, tahmin olup olmadığı gibi)
doğal bir şekilde kullanıcıya yansıt.

## Güncel durum bloğu

Kullanıcının mesajının başında [GÜNCEL DURUM] bloğu gelebilir: bugünün tarihi, kalan
kalori, takvimdeki planlı antrenmanlar ve son kilo bilgisi. Bunu kullanıcı yazmadı,
sistem ekledi — ona "şunu yazmışsın" deme, blok hakkında yorum yapma.
Kararlarını buna dayandır: öğün önerirken kalan kaloriyi gözet, program değişikliği
isteneceğinde takvimde hâlihazırda ne olduğunu oradan gör.
Kullanıcı bir günü değiştirmek isterse (ör. "salı doluyum"), o günü bloktaki mevcut
plandan bul ve create_workout_plan'ı SADECE etkilenen günlerle çağır — dokunulmayan
günleri yeniden yazma.
Bir günü BOŞALTIYORSAN (dinlenmeye çeviriyorsan ya da antrenmanı başka güne taşıyorsan)
eski günü mutlaka restDays listesine yaz. Yoksa eski antrenman takvimde durmaya devam
eder ve kullanıcı aynı antrenmanı iki gün birden görür.

## Program araçları (create_workout_plan, set_daily_targets)

Bir antrenman programı hazırladığında SADECE sohbette anlatma — **create_workout_plan**
aracını çağır ki program kullanıcının takvimine düşsün. Beslenme planı kurarken de
**set_daily_targets** ile günlük kalori/protein hedefini kaydet.
Tanışma görüşmesi biter bitmez bu ikisini çağır. Kullanıcı programı beğenmez veya
değişiklik isterse, güncellenmiş programla create_workout_plan'ı tekrar çağır.

## Kayıt dürüstlüğü (KRİTİK)

Bir şeyi kaydettiğini/güncellediğini ancak ve ancak ilgili aracı BU cevapta çağırdıysan söyle.
Aracı çağırmadan "kaydettim", "işledim", "takvime ekledim", "güncelledim" DEME — bu kullanıcıyı
yanıltır, verisi kaybolur ve sonraki hesapların yanlış çıkar.
Kullanıcı yediğini/yaptığını/kilosunu bildirdiyse önce aracı çağır, sonra cevabını yaz.
Kaydetmeyeceksen bunu açıkça söyle ("bunu kaydetmedim çünkü…").

## Cevap uzunluğu

Kısa ve uygulanabilir yaz. Sorulan şeyi cevapla, sorulmayanı anlatma. Program verirken
hareket/set/tekrar/RIR gibi bilgiyi net bir liste halinde ver; her hareketin arkasındaki
fizyolojiyi tek tek açıklama — kullanıcı sormadıkça gerekçeyi bir cümleyle geç.
Takvime program yazdıktan sonra tüm programı sohbette tekrar listeleme; kısaca özetle
ve takvimde olduğunu söyle.
`.trim();

/** One turn of stored conversation history. */
export interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * Raised on rate limiting (429) or a transient server error (5xx) — the
 * caller decides whether to retry.
 */
export class ProviderRetryableError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "ProviderRetryableError";
  }
}

/** Executes one tool call and returns its result payload. */
export type FunctionCallExecutor = (
  call: ParsedToolCall
) => Promise<{ name: string; response: Record<string, unknown> }>;

export interface GenerateCoachReplyOptions {
  executeFunctionCall: FunctionCallExecutor;
  /** Learned profile summary (StyleProfile.summary), injected if present. */
  styleProfileSummary?: string | null;
  /** Chosen conversational tone; drives a one-line style directive. */
  tone?: string | null;
  /** When true, the first-run interview instructions are injected. */
  needsOnboarding?: boolean;
  /**
   * Current calories/calendar/weight state (see src/agent/context.ts). Rides
   * with the user turn rather than the system prompt because it changes every
   * message and would otherwise invalidate the cached prefix.
   */
  liveContext?: string | null;
}

function getApiKey(): string {
  const key = process.env.KIMI_API_KEY;
  if (!key) {
    throw new Error("KIMI_API_KEY environment variable is not set");
  }
  return key;
}

function getModelName(): string {
  return process.env.KIMI_MODEL || DEFAULT_MODEL;
}

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: getApiKey(), baseURL: BASE_URL });
  }
  return client;
}

/** JSON Schema declarations → OpenAI function-tool shape. */
const tools: ChatCompletionTool[] = loggingToolDeclarations.map((decl) => ({
  type: "function",
  function: {
    name: decl.name,
    description: decl.description,
    parameters: decl.parameters,
  },
}));

/**
 * CACHE INVARIANT: parts are ordered most-stable-first, and nothing here may
 * vary per request. Kimi bills cached prefix tokens at ~1/10th the normal rate
 * and matches on an exact prefix, so interpolating a timestamp, a random id, or
 * any per-message state into this string would silently invalidate the cache on
 * every call. Volatile content belongs in the trailing user turn instead.
 */
function buildSystemPrompt(opts: GenerateCoachReplyOptions): string {
  // The FULL SKILL.md goes in on every call so the coaching rules and the hard
  // steroid boundary (section 7) are enforced in every response.
  const parts = [loadCoachSkill(), SCOPE_INSTRUCTIONS, TOOL_USAGE_INSTRUCTIONS];

  if (opts.tone) {
    parts.push(`## Konuşma tarzı\n${toneInstruction(opts.tone)}`);
  }
  if (opts.styleProfileSummary) {
    parts.push(`## Kullanıcı hakkında bilinenler\n${opts.styleProfileSummary}`);
  }
  if (opts.needsOnboarding) {
    parts.push(ONBOARDING_INSTRUCTIONS);
  }

  return parts.join("\n\n");
}

/**
 * Logs token usage per call. `cached_tokens` is what proves the 10x-cheaper
 * cache tier is actually being hit — if it stays at 0 across a conversation,
 * something upstream is varying the prompt prefix.
 */
function logUsage(usage: OpenAI.CompletionUsage | undefined): void {
  if (!usage) return;

  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  const hitRate = usage.prompt_tokens
    ? Math.round((cached / usage.prompt_tokens) * 100)
    : 0;

  console.log(
    `[kimi] in=${usage.prompt_tokens} (cached=${cached}, ${hitRate}%) ` +
      `out=${usage.completion_tokens}`
  );
}

/** Classifies provider errors so the caller can retry the transient ones. */
function toRetryableIfTransient(error: unknown): never {
  const status =
    error instanceof OpenAI.APIError ? error.status : undefined;

  if (status === 429 || (status !== undefined && status >= 500)) {
    throw new ProviderRetryableError(
      `Kimi request failed with status ${status}`,
      status
    );
  }
  throw error;
}

/**
 * Phrases that claim a write happened. Tool triggering is non-deterministic
 * (measured ~70-80% on reporting messages), and the failure mode is the model
 * *saying* it saved something without calling the tool — which silently loses
 * the user's data and corrupts later calorie maths. When we see a claim with
 * no tool call, we give the model one corrective round.
 */
const WRITE_CLAIM_PATTERN =
  /\b(kaydett|kaydedild|işledim|işledik|güncelledi|güncelledim|takvime (ekledi|yaz|al)|kaydırdım|kaydırdık|ekledim|not ettim)/i;

const CORRECTION_PROMPT =
  "SİSTEM UYARISI: Cevabında bir kayıt/güncelleme yaptığını söyledin ama ilgili aracı çağırmadın, " +
  "yani hiçbir şey kaydedilmedi. Şimdi doğru aracı çağır. Gerçekten kaydedilecek bir şey yoksa " +
  "cevabını düzelt ve kaydettiğini söyleme.";

/**
 * Generates the coach's reply for a single incoming message. If the model
 * decides to record structured data (weight/calories/workout) or save the
 * onboarding profile, those calls are executed through
 * `opts.executeFunctionCall` and the exchange continues until the model
 * produces its final natural-language reply.
 */
export async function generateCoachReply(
  userMessage: string,
  history: HistoryTurn[],
  opts: GenerateCoachReplyOptions
): Promise<string> {
  // Live state goes last, immediately before the question it should inform.
  const userContent = opts.liveContext
    ? `[GÜNCEL DURUM — kullanıcı bunu yazmadı, sistemden geliyor]\n${opts.liveContext}\n\n[KULLANICININ MESAJI]\n${userMessage}`
    : userMessage;

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt(opts) },
    ...history.map((turn) => ({ role: turn.role, content: turn.content })),
    { role: "user", content: userContent },
  ];

  let toolWasCalled = false;
  let correctionUsed = false;

  try {
    for (let round = 0; round < MAX_FUNCTION_CALL_ROUNDS; round++) {
      const model = getModelName();
      const completion = await getClient().chat.completions.create({
        model,
        max_tokens: MAX_REPLY_TOKENS,
        messages,
        tools,
        ...(isK2Family(model)
          ? ({ thinking: { type: "disabled" } } satisfies ThinkingParam)
          : { reasoning_effort: getReasoningEffort() }),
      });

      logUsage(completion.usage);

      const message = completion.choices[0]?.message;
      if (!message) {
        throw new ProviderRetryableError("Kimi returned no choices");
      }

      const toolCalls = message.tool_calls ?? [];
      if (toolCalls.length === 0) {
        const text = (message.content ?? "").trim();
        if (!text) {
          throw new ProviderRetryableError("Kimi returned an empty response");
        }

        // Claimed a write but never called a tool — nudge once, then accept
        // whatever comes back so a stubborn model can't loop us.
        if (!toolWasCalled && !correctionUsed && WRITE_CLAIM_PATTERN.test(text)) {
          correctionUsed = true;
          console.warn("[kimi] Reply claimed a write with no tool call — retrying once");
          messages.push({ role: "assistant", content: text });
          messages.push({ role: "user", content: CORRECTION_PROMPT });
          continue;
        }

        return text;
      }

      toolWasCalled = true;

      // Echo the assistant turn (carrying the tool calls) before the results.
      messages.push(message);

      for (const call of toolCalls) {
        if (call.type !== "function") continue;

        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          // Malformed arguments — tell the model instead of crashing.
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({ error: "invalid JSON arguments" }),
          });
          continue;
        }

        const { response } = await opts.executeFunctionCall({
          name: call.function.name,
          args,
        });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(response),
        });
      }
    }

    throw new ProviderRetryableError("Exceeded maximum tool-call rounds");
  } catch (error) {
    if (error instanceof ProviderRetryableError) {
      throw error;
    }
    toRetryableIfTransient(error);
  }
}
