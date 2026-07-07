import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

const OUT_DIR = process.env.TRANSCRIPTS_OUT ?? "transcripts";

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  const str = value instanceof Date ? value.toISOString() : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function extractText(parts: unknown): string {
  if (!Array.isArray(parts)) {
    return "";
  }
  const out: string[] = [];
  for (const p of parts as Record<string, unknown>[]) {
    if (!p || typeof p !== "object") {
      continue;
    }
    const type = String(p.type ?? "");
    if (type === "text" && typeof p.text === "string") {
      out.push(p.text);
    } else if (type === "reasoning" && typeof p.text === "string") {
      out.push(`[reasoning] ${p.text}`);
    } else if (type.startsWith("tool-")) {
      out.push(`[${type}] ${JSON.stringify(p)}`);
    } else {
      out.push(`[${type}]`);
    }
  }
  return out.join("\n");
}

function safeSlug(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) {
    return "";
  }
  return d.toISOString().replace("T", " ").replace(/\..*/, "Z");
}

type ChatRow = {
  chat_id: string;
  chat_title: string | null;
  chat_created_at: Date;
  partner_agent_id: string | null;
  partner_name: string | null;
  participant_external_id: string | null;
  session_started_at: Date | null;
  session_completed_at: Date | null;
  condition: string | null;
  condition_label: string | null;
  prompt_id: string | null;
  prompt_version: string | null;
  interviewer_model: string | null;
  partner_model: string | null;
  total_tokens: number | null;
};

type MsgRow = {
  created_at: Date;
  role: string;
  parts: unknown;
  partner_model: string | null;
};

async function main() {
  const url = process.env.POSTGRES_URL;
  if (!url) {
    throw new Error("POSTGRES_URL is required");
  }

  mkdirSync(OUT_DIR, { recursive: true });

  const sql = postgres(url);
  try {
    const chats = (await sql`
      SELECT
        c.id                            AS chat_id,
        c.title                         AS chat_title,
        c."createdAt"                   AS chat_created_at,
        c."partnerAgentId"              AS partner_agent_id,
        pa.name                         AS partner_name,
        p."externalId"                  AS participant_external_id,
        s."createdAt"                   AS session_started_at,
        s."completedAt"                 AS session_completed_at,
        s.condition                     AS condition,
        s."conditionLabel"              AS condition_label,
        s."promptId"                    AS prompt_id,
        s."promptVersion"               AS prompt_version,
        s."interviewerModel"            AS interviewer_model,
        s."partnerModel"                AS partner_model,
        s."totalTokens"                 AS total_tokens
      FROM "Chat" c
      LEFT JOIN "AgentSession" s   ON s."chatId" = c.id
      LEFT JOIN "PartnerAgent" pa  ON pa.id = c."partnerAgentId"
      LEFT JOIN "Participant" p    ON p.id = c."participantId"
      ORDER BY c."createdAt" ASC
    `) as unknown as ChatRow[];

    if (chats.length === 0) {
      process.stderr.write("no chats found\n");
      return;
    }

    const indexRows: string[] = [];
    indexRows.push("# Interview Transcripts\n");
    indexRows.push(
      `Exported ${new Date().toISOString()} — ${chats.length} conversations\n`
    );
    indexRows.push("## How to read this");
    indexRows.push(
      "Each row below is one interview. The chatbot (the *Interviewer*) is an OpenAI Stored Prompt, pinned at session start to one of three conditions. The *Participant* is either a human respondent (browser UI) or another AI agent (back-to-back API call), as noted by *Source*. Open the matching `.md` file for the readable transcript or the `.csv` for raw turn-by-turn data.\n"
    );
    indexRows.push(
      "| # | Started | Condition | Source | Partner / Participant | Turns | Tokens | File |"
    );
    indexRows.push("|---|---|---|---|---|---|---|---|");

    for (let i = 0; i < chats.length; i++) {
      const c = chats[i];
      const messages = (await sql`
        SELECT
          m."createdAt"     AS created_at,
          m.role            AS role,
          m.parts           AS parts,
          m."partnerModel"  AS partner_model
        FROM "Message_v2" m
        WHERE m."chatId" = ${c.chat_id}
        ORDER BY m."createdAt" ASC
      `) as unknown as MsgRow[];

      const isAgentSession = c.partner_agent_id !== null;
      const intervieweeLabel = isAgentSession
        ? "Interviewee Agent"
        : "Participant";
      const source = isAgentSession ? "Agent" : "Human";
      const partnerOrParticipant = isAgentSession
        ? `${c.partner_name ?? "?"} / ${c.participant_external_id ?? "?"}`
        : (c.participant_external_id ?? "human");

      const startedAt = c.session_started_at ?? c.chat_created_at;
      const datePart = startedAt
        ? startedAt.toISOString().slice(0, 10)
        : "unknown";
      const filenameBase = safeSlug(
        `${datePart}_${c.condition ?? "X"}_${c.chat_id.slice(0, 8)}`
      );

      // ── CSV ───────────────────────────────────────────────
      const csvLines: string[] = [];
      csvLines.push(
        ["turn", "timestamp", "role", "speaker", "text", "partner_model"]
          .map(csvEscape)
          .join(",")
      );
      let turn = 0;
      for (const m of messages) {
        turn += 1;
        const speaker =
          m.role === "assistant"
            ? "Interviewer"
            : m.role === "user"
              ? intervieweeLabel
              : m.role;
        csvLines.push(
          [
            turn,
            m.created_at.toISOString(),
            m.role,
            speaker,
            extractText(m.parts),
            m.partner_model ?? "",
          ]
            .map(csvEscape)
            .join(",")
        );
      }
      writeFileSync(
        path.join(OUT_DIR, `${filenameBase}.csv`),
        `${csvLines.join("\n")}\n`,
        "utf8"
      );

      // ── Markdown ──────────────────────────────────────────
      const md: string[] = [];
      const conditionLine = c.condition_label
        ? `${c.condition ?? "?"} — *${c.condition_label}*`
        : (c.condition ?? "unknown");
      md.push(`# Interview — condition ${conditionLine}`);
      md.push("");
      md.push("| Field | Value |");
      md.push("|---|---|");
      md.push(`| Chat ID | \`${c.chat_id}\` |`);
      md.push(`| Source | ${source} |`);
      md.push(`| Started | ${fmtDate(startedAt)} |`);
      md.push(`| Completed | ${fmtDate(c.session_completed_at) || "—"} |`);
      md.push(`| Turns | ${messages.length} |`);
      md.push(`| Total tokens | ${c.total_tokens ?? "—"} |`);
      md.push(`| Interviewer model | ${c.interviewer_model ?? "—"} |`);
      md.push(`| Interviewee model | ${c.partner_model ?? "—"} |`);
      md.push(
        `| Prompt | ${c.prompt_id ?? "—"} (v${c.prompt_version ?? "—"}) |`
      );
      if (isAgentSession) {
        md.push(`| Partner agent | ${c.partner_name ?? "—"} |`);
        md.push(
          `| Participant external id | ${c.participant_external_id ?? "—"} |`
        );
      }
      md.push("");
      md.push("---");
      md.push("");

      if (messages.length === 0) {
        md.push("_(no messages)_");
      } else {
        for (const m of messages) {
          const speaker =
            m.role === "assistant"
              ? "Interviewer"
              : m.role === "user"
                ? intervieweeLabel
                : m.role;
          const text = extractText(m.parts).trim();
          md.push(`**${speaker}** _(${fmtDate(m.created_at)})_`);
          md.push("");
          md.push(text.length > 0 ? text : "_(empty)_");
          md.push("");
        }
      }

      writeFileSync(
        path.join(OUT_DIR, `${filenameBase}.md`),
        `${md.join("\n")}\n`,
        "utf8"
      );

      indexRows.push(
        `| ${i + 1} | ${fmtDate(startedAt)} | ${
          c.condition ?? "?"
        }${c.condition_label ? ` (${c.condition_label})` : ""} | ${source} | ${partnerOrParticipant} | ${messages.length} | ${c.total_tokens ?? "—"} | [${filenameBase}.md](./${filenameBase}.md) / [csv](./${filenameBase}.csv) |`
      );

      process.stderr.write(
        `wrote ${filenameBase} (${messages.length} turns)\n`
      );
    }

    writeFileSync(
      path.join(OUT_DIR, "index.md"),
      `${indexRows.join("\n")}\n`,
      "utf8"
    );

    process.stderr.write(
      `\nDone. ${chats.length} conversations written to ${OUT_DIR}/\n`
    );
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
