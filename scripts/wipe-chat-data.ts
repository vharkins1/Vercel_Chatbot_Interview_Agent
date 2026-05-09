import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

async function main() {
  const url = process.env.POSTGRES_URL;
  if (!url) throw new Error("POSTGRES_URL is required");

  const sql = postgres(url);
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(`
        TRUNCATE TABLE
          "ChatQuestion", "Message_v2", "AgentSession",
          "Chat", "Participant", "Invitation"
        RESTART IDENTITY CASCADE;
      `);
      await tx.unsafe(`DELETE FROM "User";`);
    });

    const after = await sql`
      SELECT
        (SELECT COUNT(*) FROM "Chat")         AS chats,
        (SELECT COUNT(*) FROM "Message_v2")   AS messages,
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
