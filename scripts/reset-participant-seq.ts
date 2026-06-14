/**
 * One-off: remove the validation/test sessions that consumed participant
 * numbers and restart the counter at 1, so the first REAL participant is #1.
 *
 *   tsx scripts/reset-participant-seq.ts
 *
 * Scope is deliberately narrow: it only touches AgentSession rows that have a
 * non-null `seq` (i.e. created after migration 0019). Pre-0019 rows are all
 * NULL and untouched. Prints exactly what it will delete before doing so.
 */
import { config } from "dotenv";

config({ path: ".env.local" });

import postgres from "postgres";

async function main() {
  const url = process.env.POSTGRES_URL;
  if (!url) {
    throw new Error("POSTGRES_URL not set");
  }
  const sql = postgres(url, { max: 1 });
  try {
    const targets = await sql<
      Array<{
        seq: number;
        chatId: string;
        userId: string;
        partnerAgentId: string | null;
        participantId: string | null;
        partnerModel: string | null;
      }>
    >`
      SELECT seq, "chatId", "userId", "partnerAgentId", "participantId", "partnerModel"
      FROM "AgentSession"
      WHERE seq IS NOT NULL
      ORDER BY seq`;

    if (targets.length === 0) {
      console.log("No numbered sessions to remove. Resetting sequence to 1.");
    } else {
      console.log(`Removing ${targets.length} numbered test session(s):`);
      for (const t of targets) {
        console.log(
          `  #${t.seq}  ${t.chatId}  model=${t.partnerModel ?? "—"}`
        );
      }
    }

    await sql.begin(async (tx) => {
      const chatIds = targets.map((t) => t.chatId);
      if (chatIds.length > 0) {
        await tx`DELETE FROM "SurveyAnswer" WHERE "chatId" = ANY(${chatIds})`;
        await tx`DELETE FROM "SurveySubmission" WHERE "chatId" = ANY(${chatIds})`;
        await tx`DELETE FROM "Message_v2" WHERE "chatId" = ANY(${chatIds})`;
        await tx`DELETE FROM "ChatQuestion" WHERE "chatId" = ANY(${chatIds})`;
        await tx`DELETE FROM "AgentSession" WHERE "chatId" = ANY(${chatIds})`;
        await tx`DELETE FROM "Chat" WHERE id = ANY(${chatIds})`;

        const participantIds = [
          ...new Set(
            targets.map((t) => t.participantId).filter((x): x is string => !!x)
          ),
        ];
        const userIds = [...new Set(targets.map((t) => t.userId))];
        const partnerIds = [
          ...new Set(
            targets.map((t) => t.partnerAgentId).filter((x): x is string => !!x)
          ),
        ];
        if (participantIds.length > 0) {
          await tx`DELETE FROM "Participant" WHERE id = ANY(${participantIds})`;
        }
        if (userIds.length > 0) {
          await tx`DELETE FROM "User" WHERE id = ANY(${userIds})`;
        }
        if (partnerIds.length > 0) {
          await tx`DELETE FROM "PartnerAgent" WHERE id = ANY(${partnerIds})`;
        }
      }
      await tx`ALTER SEQUENCE "AgentSession_seq_seq" RESTART WITH 1`;
    });

    const [remaining] = await sql<Array<{ n: number }>>`
      SELECT count(seq)::int AS n FROM "AgentSession"`;
    console.log(
      `\n✓ Done. Numbered sessions remaining: ${remaining.n}. Next participant will be #1.`
    );
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
