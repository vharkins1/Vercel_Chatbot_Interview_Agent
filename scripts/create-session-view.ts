import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

const VIEW_SQL = `
CREATE OR REPLACE VIEW "SessionOverview" AS
SELECT
  s."createdAt"     AS started_at,
  s."completedAt"   AS completed_at,
  pa.name           AS partner,
  p."externalId"    AS participant,
  p.metadata        AS condition,
  c.title           AS title,
  s."promptId"      AS prompt_id,
  s."promptVersion" AS prompt_version,
  s."totalTokens"   AS total_tokens,
  (SELECT COUNT(*) FROM "Message_v2" m WHERE m."chatId" = c.id) AS turns,
  c.id              AS chat_id
FROM "AgentSession" s
JOIN "Chat"         c  ON c.id = s."chatId"
LEFT JOIN "Participant"  p  ON p.id  = s."participantId"
LEFT JOIN "PartnerAgent" pa ON pa.id = s."partnerAgentId";
`;

async function main() {
  const url = process.env.POSTGRES_URL;
  if (!url) {
    throw new Error("POSTGRES_URL is required");
  }

  const sql = postgres(url);
  try {
    await sql.unsafe(VIEW_SQL);
    console.log('created or replaced view "SessionOverview"');
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
