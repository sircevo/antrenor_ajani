"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { logWeightEntry } from "@/agent/logging";

/**
 * Dashboard quick-add form action. Reuses the exact same write path as the
 * Telegram agent's log_weight tool (src/agent/logging.ts) so both entry
 * points stay consistent.
 */
export async function addWeightEntry(formData: FormData): Promise<void> {
  const weightKg = Number(formData.get("weightKg"));
  const note = formData.get("note");

  if (!Number.isFinite(weightKg) || weightKg <= 0) {
    throw new Error("Geçerli bir kilo değeri girin");
  }

  await logWeightEntry(
    prisma,
    weightKg,
    typeof note === "string" && note.trim() ? note.trim() : undefined
  );

  revalidatePath("/");
}
