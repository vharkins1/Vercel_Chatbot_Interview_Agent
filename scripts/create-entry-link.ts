/**
 * Mint the single reusable entry link used by the Qualtrics-first human flow.
 *
 * Unlike scripts/create-invitations.ts (one one-shot token per participant,
 * with the study arm pinned at mint time), this creates ONE multi-use token
 * that pins no arm. Every participant follows the same URL; the server draws a
 * condition at session creation and identity comes from the Qualtrics
 * ResponseID passed as `rid`.
 *
 * Usage:
 *   pnpm db:create-entry-link --base-url https://<app> [--ttl-days 180] [--label pilot]
 *
 * Paste the printed URL into the PRE-survey's End of Survey element
 * ("Redirect to a URL"). The ${e://Field/ResponseID} placeholder is expanded by
 * Qualtrics at redirect time.
 */
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { invitation } from "../lib/db/schema";
import { generateJti, signInvitation } from "../lib/study/invitations";

config({ path: ".env.local" });

type Args = {
  baseUrl: string;
  ttlDays: number;
  label: string | null;
};

function parseArgs(argv: string[]): Args {
  const args: {
    baseUrl: string | null;
    ttlDays: number;
    label: string | null;
  } = { baseUrl: null, ttlDays: 180, label: null };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case "--base-url":
        args.baseUrl = value;
        i++;
        break;
      case "--ttl-days":
        args.ttlDays = Number.parseInt(value, 10);
        i++;
        break;
      case "--label":
        args.label = value;
        i++;
        break;
      default:
        if (flag.startsWith("--")) {
          throw new Error(`Unknown flag: ${flag}`);
        }
    }
  }
  if (!args.baseUrl) {
    throw new Error(
      "--base-url is required (e.g. --base-url https://your-app.vercel.app)"
    );
  }
  if (!Number.isFinite(args.ttlDays) || args.ttlDays <= 0) {
    throw new Error("--ttl-days must be a positive integer");
  }
  return { ...args, baseUrl: args.baseUrl };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const url = process.env.POSTGRES_URL;
  if (!url) {
    throw new Error("POSTGRES_URL is required");
  }
  if (!process.env.INVITE_JWT_SECRET) {
    throw new Error("INVITE_JWT_SECRET is required");
  }

  const ttlSeconds = args.ttlDays * 24 * 60 * 60;
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  const sql = postgres(url);
  const db = drizzle(sql);

  try {
    const jti = generateJti();
    // condition: null is the whole point — the arm is drawn per session by the
    // server, so it never passes through Qualtrics and stays blinded.
    const token = await signInvitation({ jti, condition: null, ttlSeconds });

    await db.insert(invitation).values({
      jti,
      condition: null,
      conditionLabel: null,
      expiresAt,
      batchLabel: args.label,
      multiUse: true,
    });

    const base = args.baseUrl.replace(/\/+$/, "");
    const redirect = `${base}/chat?t=${token}&StudyID=\${e://Field/StudyID}`;

    console.error("Entry link created.");
    console.error(`  jti:        ${jti}`);
    console.error(`  expires:    ${expiresAt.toISOString()}`);
    console.error(`  label:      ${args.label ?? "(none)"}`);
    console.error("");
    console.error(
      "Paste this into the PRE-survey → Survey Flow → End of Survey →"
    );
    console.error('"Redirect to a URL":');
    console.error("");
    console.log(redirect);
    console.error("");
    console.error("Then, on the POST-survey, declare these Embedded Data");
    console.error("fields ABOVE the first block or Qualtrics will drop them:");
    console.error("  rid, chat_id, participant_seq, completion_code");
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
