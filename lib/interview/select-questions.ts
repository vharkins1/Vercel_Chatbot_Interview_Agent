import "server-only";

import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { question } from "@/lib/db/schema";
import {
  getRuntimePrompt,
  RUNTIME_PROMPT_KEYS,
} from "@/lib/study/runtime-prompts";

type TxArg = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | TxArg;

export type SelectedQuestion = {
  questionId: string;
  topicId: string;
  topicName: string;
  text: string;
  topicOrder: number;
  questionOrder: number;
};

const QUESTIONS_PER_TOPIC = 3;

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

async function loadBank(executor: Executor): Promise<
  Array<{
    topicId: string;
    topicName: string;
    questions: Array<{ id: string; text: string }>;
  }>
> {
  const rows = await executor
    .select()
    .from(question)
    .where(and(eq(question.isActive, true), isNull(question.chatId)))
    .orderBy(asc(question.topicDisplayOrder), asc(question.topicId));

  const topics = new Map<
    string,
    {
      topicId: string;
      topicName: string;
      questions: Array<{ id: string; text: string }>;
    }
  >();
  for (const row of rows) {
    const existing = topics.get(row.topicId);
    if (existing) {
      existing.questions.push({ id: row.id, text: row.text });
      continue;
    }
    topics.set(row.topicId, {
      topicId: row.topicId,
      topicName: row.topicName,
      questions: [{ id: row.id, text: row.text }],
    });
  }
  return Array.from(topics.values());
}

export async function selectQuestionsForChat(
  chatId: string,
  opts: { tx?: Executor; rng?: () => number } = {}
): Promise<SelectedQuestion[]> {
  const executor = opts.tx ?? db;
  const rng = opts.rng ?? Math.random;

  const bank = await loadBank(executor);
  if (bank.length < 5) {
    throw new Error(
      `Question bank has ${bank.length} topics, expected 5 — run db:migrate to seed.`
    );
  }

  const shuffledTopics = shuffle(bank, rng);
  const selected: SelectedQuestion[] = [];

  shuffledTopics.forEach((t, topicIdx) => {
    if (t.questions.length < QUESTIONS_PER_TOPIC) {
      throw new Error(
        `Topic ${t.topicId} has ${t.questions.length} active questions, need ≥ ${QUESTIONS_PER_TOPIC}.`
      );
    }
    const picked = shuffle(t.questions, rng).slice(0, QUESTIONS_PER_TOPIC);
    picked.forEach((q, qIdx) => {
      selected.push({
        questionId: q.id,
        topicId: t.topicId,
        topicName: t.topicName,
        text: q.text,
        topicOrder: topicIdx + 1,
        questionOrder: qIdx + 1,
      });
    });
  });

  await executor
    .insert(question)
    .values(
      selected.map((selectedQuestion) => ({
        chatId,
        sourceQuestionId: selectedQuestion.questionId,
        topicId: selectedQuestion.topicId,
        topicName: selectedQuestion.topicName,
        text: selectedQuestion.text,
        topicOrder: selectedQuestion.topicOrder,
        questionOrder: selectedQuestion.questionOrder,
      }))
    )
    .onConflictDoNothing();

  return selected;
}

export async function getChatQuestions(
  chatId: string
): Promise<SelectedQuestion[]> {
  const rows = await db
    .select({
      questionId: question.sourceQuestionId,
      topicId: question.topicId,
      topicName: question.topicName,
      text: question.text,
      topicOrder: question.topicOrder,
      questionOrder: question.questionOrder,
    })
    .from(question)
    .where(eq(question.chatId, chatId))
    .orderBy(asc(question.topicOrder), asc(question.questionOrder));

  return rows.map((row) => {
    if (
      !row.questionId ||
      row.topicOrder === null ||
      row.questionOrder === null
    ) {
      throw new Error(`Malformed selected question row for chat ${chatId}.`);
    }
    return {
      questionId: row.questionId,
      topicId: row.topicId,
      topicName: row.topicName,
      text: row.text,
      topicOrder: row.topicOrder,
      questionOrder: row.questionOrder,
    };
  });
}

export async function ensureChatQuestions(
  chatId: string
): Promise<SelectedQuestion[]> {
  const existing = await getChatQuestions(chatId);
  if (existing.length > 0) {
    return existing;
  }
  return selectQuestionsForChat(chatId);
}

// The 15 study questions above are sampled and shuffled per chat; this 16th
// one is fixed, identical for conditions A/B/C, and always last. It doubles as
// the end-of-interview signal (lib/study/interview-end.ts matches on it), so
// the interviewer must emit it verbatim and stop. The participant-facing
// survey URL is appended to that message server-side — the interviewer must
// not invent one.
export async function formatQuestionsForPrompt(
  rows: SelectedQuestion[]
): Promise<string> {
  const closingQuestion = await getRuntimePrompt(
    RUNTIME_PROMPT_KEYS.closingQuestion
  );
  const closingBlock = [
    "FINAL QUESTION (16) — CLOSING",
    "Ask this last, after every topic above is covered, as its own final message.",
    "Say it verbatim and end the message there. Do not add a URL: the survey link",
    "is appended automatically after your message is sent.",
    `1. ${closingQuestion}`,
  ].join("\n");
  const byTopic = new Map<number, SelectedQuestion[]>();
  for (const r of rows) {
    const list = byTopic.get(r.topicOrder) ?? [];
    list.push(r);
    byTopic.set(r.topicOrder, list);
  }

  const blocks: string[] = [];
  const topicOrders = Array.from(byTopic.keys()).sort((a, b) => a - b);
  for (const order of topicOrders) {
    const items = (byTopic.get(order) ?? []).sort(
      (a, b) => a.questionOrder - b.questionOrder
    );
    const header = `TOPIC ${order} — ${items[0]?.topicName ?? items[0]?.topicId ?? ""}`;
    const lines = items.map((q, i) => `${i + 1}. ${q.text}`);
    blocks.push([header, ...lines].join("\n"));
  }
  blocks.push(closingBlock);
  return blocks.join("\n\n");
}
