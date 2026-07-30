/**
 * Loads the coach skill definition (SKILL.md) that is passed to Gemini as a
 * systemInstruction on every call. Reading it from disk (instead of hardcoding
 * a copy) guarantees the model always receives the FULL, current rule set —
 * including the hard steroid boundary in section 7.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const SKILL_PATH = join(
  process.cwd(),
  ".antigravity",
  "skills",
  "hipertrofi-antrenor",
  "SKILL.md"
);

let cachedSkill: string | null = null;

/**
 * Returns the raw SKILL.md contents. Cached after the first read since the
 * file does not change while the agent is running.
 */
export function loadCoachSkill(): string {
  if (cachedSkill !== null) {
    return cachedSkill;
  }

  const content = readFileSync(SKILL_PATH, "utf8").trim();
  if (!content) {
    throw new Error(`Coach skill file is empty: ${SKILL_PATH}`);
  }

  cachedSkill = content;
  return cachedSkill;
}
