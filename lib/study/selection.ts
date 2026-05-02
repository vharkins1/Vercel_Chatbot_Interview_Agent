import "server-only";
import questionsData from "./prompts/questions.json";
import { QUESTIONS_PER_TOPIC, TOPICS } from "./protocol.config";

const TOPICS_PER_SESSION = 3;

type RawQuestion = {
  topic: string;
  intimacy: "low" | "moderate" | "high";
  text: string;
};

const QUESTIONS_BY_TOPIC: ReadonlyMap<string, readonly string[]> = (() => {
  const map = new Map<string, string[]>();
  for (const q of questionsData as RawQuestion[]) {
    const list = map.get(q.topic) ?? [];
    list.push(q.text);
    map.set(q.topic, list);
  }
  return map;
})();

function shuffleIndices(n: number): number[] {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function pickStudyPlan(): {
  topicOrder: number[];
  questionOrder: number[][];
} {
  const topicOrder = shuffleIndices(TOPICS.length).slice(0, TOPICS_PER_SESSION);
  const questionOrder = topicOrder.map(() =>
    shuffleIndices(QUESTIONS_PER_TOPIC),
  );
  return { topicOrder, questionOrder };
}

export function formatQuestionsBlock(
  topicOrder: number[],
  questionOrder: number[][],
): string {
  const blocks: string[] = [];
  for (let i = 0; i < topicOrder.length; i++) {
    const topic = TOPICS[topicOrder[i]];
    if (!topic) continue;
    const questionTexts = QUESTIONS_BY_TOPIC.get(topic.name) ?? [];
    const lines = [`Topic ${i + 1} — ${topic.name}`];
    const order = questionOrder[i] ?? [];
    for (let j = 0; j < order.length; j++) {
      const text = questionTexts[order[j]];
      if (text) lines.push(`  ${j + 1}. ${text}`);
    }
    blocks.push(lines.join("\n"));
  }
  return blocks.join("\n\n");
}
