import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { invitation } from "../lib/db/schema";
import {
  ALL_CONDITIONS,
  type Condition,
  isCondition,
} from "../lib/study/conditions";
import { generateJti, signInvitation } from "../lib/study/invitations";

config({ path: ".env.local" });

type Args = {
  count: number;
  condition: Condition | "mixed";
  batch: string | null;
  ttlDays: number;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    count: 0,
    condition: "mixed",
    batch: null,
    ttlDays: 30,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case "--count":
        args.count = Number.parseInt(value, 10);
        i++;
        break;
      case "--condition":
        if (value === "mixed" || isCondition(value)) {
          args.condition = value;
        } else {
          throw new Error(
            `--condition must be one of: mixed, ${ALL_CONDITIONS.join(", ")}`
          );
        }
        i++;
        break;
      case "--batch":
        args.batch = value;
        i++;
        break;
      case "--ttl-days":
        args.ttlDays = Number.parseInt(value, 10);
        i++;
        break;
      default:
        if (flag.startsWith("--")) {
          throw new Error(`Unknown flag: ${flag}`);
        }
    }
  }
  if (!Number.isFinite(args.count) || args.count <= 0) {
    throw new Error("--count must be a positive integer");
  }
  if (!Number.isFinite(args.ttlDays) || args.ttlDays <= 0) {
    throw new Error("--ttl-days must be a positive integer");
  }
  return args;
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function buildAssignment(
  count: number,
  condition: Args["condition"]
): Condition[] {
  if (condition !== "mixed") {
    return Array.from({ length: count }, () => condition);
  }
  // Round-robin across conditions; shuffled order to avoid predictable patterns.
  const out: Condition[] = [];
  while (out.length < count) {
    out.push(...shuffle([...ALL_CONDITIONS]));
  }
  return out.slice(0, count);
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
  const assignment = buildAssignment(args.count, args.condition);

  const sql = postgres(url);
  const db = drizzle(sql);

  try {
    const tokens: string[] = [];
    const counts: Record<Condition, number> = {
      A: 0,
      B: 0,
      C: 0,
    };

    const { labelForCondition } = await import("../lib/study/conditions");

    for (const cond of assignment) {
      const jti = generateJti();
      const token = await signInvitation({
        jti,
        condition: cond,
        ttlSeconds,
      });
      await db.insert(invitation).values({
        jti,
        condition: cond,
        conditionLabel: labelForCondition(cond),
        expiresAt,
        batchLabel: args.batch,
      });
      tokens.push(token);
      counts[cond]++;
    }

    console.error(
      `created ${args.count} invitation(s)` +
        (args.batch ? ` in batch ${args.batch}` : "") +
        ` — A:${counts.A} B:${counts.B} C:${counts.C}`
    );
    console.error(`expires at: ${expiresAt.toISOString()}`);
    console.error("");
    console.error("tokens (one per line, condition prefix):");
    for (let i = 0; i < tokens.length; i++) {
      // tokens to stdout; condition tag to stderr so stdout is pipeable
      console.error(`# ${assignment[i]}`);
      console.log(tokens[i]);
    }
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
