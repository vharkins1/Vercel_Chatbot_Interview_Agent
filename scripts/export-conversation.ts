import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import postgres from "postgres";
import { z } from "zod";
import {
  formatConversationTranscript,
  formatPacificTimestamp,
  type TranscriptConversation,
  type TranscriptMessage,
  transcriptDate,
} from "@/lib/transcript";

config({ path: ".env.local" });

const OUT_DIR = process.env.TRANSCRIPTS_OUT ?? "transcripts";

const main = async () => {
  const chatId = process.argv[2]?.trim();
  if (!chatId) {
    throw new Error(
      "ChatID is required. Usage: pnpm db:export-conversation <chat-id>"
    );
  }
  if (!z.string().uuid().safeParse(chatId).success) {
    throw new Error("ChatID must be a valid UUID");
  }

  const url = process.env.POSTGRES_URL;
  if (!url) {
    throw new Error("POSTGRES_URL is required");
  }

  const sql = postgres(url, { max: 1 });
  try {
    const conversations = (await sql`
      SELECT
        c.id                   AS "chatId",
        c."createdAt"          AS "chatCreatedAt",
        c."partnerAgentId"     AS "partnerAgentId",
        s."createdAt"          AS "sessionCreatedAt",
        s.condition            AS condition,
        s."promptId"           AS "promptId",
        s."promptVersion"      AS "promptVersion",
        s."interviewerModel"   AS "interviewerModel"
      FROM "Chat" c
      LEFT JOIN "AgentSession" s ON s."chatId" = c.id
      WHERE c.id = ${chatId}
      LIMIT 1
    `) as unknown as TranscriptConversation[];

    const conversation = conversations[0];
    if (!conversation) {
      throw new Error(`No conversation found for ChatID ${chatId}`);
    }

    const messages = (await sql`
      SELECT
        m."createdAt"   AS "createdAt",
        m.role          AS role,
        m.parts         AS parts
      FROM "Message_v2" m
      WHERE m."chatId" = ${conversation.chatId}
      ORDER BY m."createdAt" ASC, m.id ASC
    `) as unknown as TranscriptMessage[];

    const date = transcriptDate(conversation);
    const pacificTimestamp = formatPacificTimestamp(date);
    const transcript = formatConversationTranscript({ conversation, messages });
    const conversationDirectory = path.resolve(
      OUT_DIR,
      `${pacificTimestamp}_${conversation.chatId}`
    );
    mkdirSync(conversationDirectory, { recursive: true });

    const outputPath = path.join(conversationDirectory, "transcript.md");
    writeFileSync(outputPath, transcript, "utf8");
    execFileSync("open", [outputPath], { stdio: "ignore" });
    process.stdout.write(`${outputPath}\n`);
  } finally {
    await sql.end();
  }
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
