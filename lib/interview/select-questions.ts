import "server-only";

import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { chatQuestion, question, topic } from "@/lib/db/schema";

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
  const topics = await executor.select().from(topic);
  const questions = await executor
    .select()
    .from(question)
    .where(eq(question.isActive, true));

  return topics.map((t) => ({
    topicId: t.id,
    topicName: t.name,
    questions: questions
      .filter((q) => q.topicId === t.id)
      .map((q) => ({ id: q.id, text: q.text })),
  }));
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
    .insert(chatQuestion)
    .values(
      selected.map((s) => ({
        chatId,
        questionId: s.questionId,
        topicId: s.topicId,
        topicOrder: s.topicOrder,
        questionOrder: s.questionOrder,
        questionTextSnapshot: s.text,
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
      questionId: chatQuestion.questionId,
      topicId: chatQuestion.topicId,
      topicName: topic.name,
      text: chatQuestion.questionTextSnapshot,
      topicOrder: chatQuestion.topicOrder,
      questionOrder: chatQuestion.questionOrder,
    })
    .from(chatQuestion)
    .innerJoin(topic, eq(topic.id, chatQuestion.topicId))
    .where(eq(chatQuestion.chatId, chatId))
    .orderBy(asc(chatQuestion.topicOrder), asc(chatQuestion.questionOrder));
  return rows;
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

export function formatQuestionsForPrompt(rows: SelectedQuestion[]): string {
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
  return blocks.join("\n\n");
}
