import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

async function main() {
  const url = process.env.POSTGRES_URL;
  if (!url) {
    throw new Error("POSTGRES_URL is required");
  }

  const sql = postgres(url);
  try {
    await sql.begin(async (tx) => {
      await tx`DELETE FROM "SurveyAnswer"`;
      await tx`DELETE FROM "SurveySubmission"`;
      await tx`DELETE FROM "Question" WHERE "chatId" IS NOT NULL`;
      await tx`DELETE FROM "ChatLogs"`;
      await tx`DELETE FROM "AgentSession"`;
      await tx`DELETE FROM "Invitation"`;
      await tx`DELETE FROM "Chat"`;
      await tx`DELETE FROM "Participant"`;
      await tx`DELETE FROM "User"`;
      await tx`ALTER SEQUENCE "AgentSession_seq_seq" RESTART WITH 1`;
    });

    const after = await sql`
      SELECT
        (SELECT COUNT(*) FROM "Chat")         AS chats,
        (SELECT COUNT(*) FROM "ChatLogs")     AS messages,
        (SELECT COUNT(*) FROM "AgentSession") AS agent_sessions,
        (SELECT COUNT(*) FROM "Participant")  AS participants,
        (SELECT COUNT(*) FROM "User")         AS users,
        (SELECT COUNT(*) FROM "PartnerAgent") AS partner_agents
    `;
    console.log("post-wipe row counts:");
    console.log(JSON.stringify(after[0], null, 2));
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
