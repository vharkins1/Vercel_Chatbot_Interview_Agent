import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { user } from "../lib/db/schema";

config({
  path: ".env.local",
});

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function main() {
  const url = process.env.POSTGRES_URL;
  const userId = process.env.AGENT_USER_ID;

  if (!url) throw new Error("POSTGRES_URL is required");
  if (!userId) throw new Error("AGENT_USER_ID is required");
  if (!UUID_PATTERN.test(userId)) {
    throw new Error("AGENT_USER_ID must be a valid UUID");
  }

  const sql = postgres(url);
  const db = drizzle(sql);

  try {
    const inserted = await db
      .insert(user)
      .values({
        id: userId,
        email: "agent-service@local",
        password: null,
        isAnonymous: false,
        emailVerified: false,
      })
      .onConflictDoNothing({ target: user.id })
      .returning({ id: user.id });

    if (inserted.length === 0) {
      console.log(`agent user already exists: ${userId}`);
    } else {
      console.log(`seeded agent user: ${userId}`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
