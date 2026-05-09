import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

async function main() {
  const url = process.env.POSTGRES_URL;
  if (!url) throw new Error("POSTGRES_URL is required");

  const sql = postgres(url);
  try {
    const counts = await sql`
      SELECT
        (SELECT COUNT(*) FROM "Chat")           AS chats,
        (SELECT COUNT(*) FROM "Message_v2")     AS messages,
        (SELECT COUNT(*) FROM "AgentSession")   AS agent_sessions,
        (SELECT COUNT(*) FROM "Participant")    AS participants,
        (SELECT COUNT(*) FROM "PartnerAgent")   AS partner_agents,
        (SELECT COUNT(*) FROM "Invitation")     AS invitations,
        (SELECT COUNT(*) FROM "User")           AS users,
        (SELECT COUNT(*) FROM "User" WHERE "isAnonymous" = true) AS anonymous_users
    `;
    console.log(JSON.stringify(counts[0], null, 2));
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
