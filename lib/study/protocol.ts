/**
 * Study Protocol Engine
 *
 * Imports settings from protocol.config.ts (client-safe) and loads
 * prompts/questions lazily via protocol.prompts.ts (server-only, async).
 *
 * All prompt-dependent functions are async to support Vercel Blob loading.
 */

import {
  MAX_REATTEMPTS as CONFIG_MAX_REATTEMPTS,
  QUESTIONS_PER_TOPIC as CONFIG_QUESTIONS_PER_TOPIC,
  TOPIC_ORDER,
  TOPICS as CONFIG_TOPICS,
} from "./protocol.config";
import { getPrompts } from "./protocol.prompts";

// ── Re-exported Config ───────────────────────────────────────

export const QUESTIONS_PER_TOPIC = CONFIG_QUESTIONS_PER_TOPIC;
export const MAX_REATTEMPTS = CONFIG_MAX_REATTEMPTS;
export const TOPICS = CONFIG_TOPICS;
export const TOTAL_TOPICS = CONFIG_TOPICS.length;

// ── Types ────────────────────────────────────────────────────

export type StudyPhase =
  | "welcome"
  | "consent"
  | "questioning"
  | "feedback"
  | "complete";

export type Condition = "positive" | "negative" | "neutral";

export type IntimacyLevel = "low" | "moderate" | "high";

export type StudyQuestion = {
  topicIndex: number;
  questionIndex: number;
  intimacy: IntimacyLevel;
  text: string;
};

export type StudyState = {
  phase: StudyPhase;
  topicIndex: number;
  questionIndex: number;
};

// ── Internal Helpers ─────────────────────────────────────────

/**
 * Build a flat lookup of questions keyed by `topicIdx:questionIdx`.
 */
async function buildQuestionLookup(): Promise<
  Map<string, { text: string; intimacy: IntimacyLevel; topicName: string }>
> {
  const prompts = await getPrompts();
  const lookup = new Map<
    string,
    { text: string; intimacy: IntimacyLevel; topicName: string }
  >();

  const byTopic = new Map<
    string,
    Array<{ text: string; intimacy: IntimacyLevel }>
  >();
  for (const q of prompts.questions) {
    const list = byTopic.get(q.topicName) ?? [];
    list.push({ text: q.text, intimacy: q.intimacy as IntimacyLevel });
    byTopic.set(q.topicName, list);
  }

  for (let tIdx = 0; tIdx < CONFIG_TOPICS.length; tIdx++) {
    const topicName = CONFIG_TOPICS[tIdx].name;
    const topicQuestions = byTopic.get(topicName) ?? [];
    for (let qIdx = 0; qIdx < topicQuestions.length; qIdx++) {
      lookup.set(`${tIdx}:${qIdx}`, {
        text: topicQuestions[qIdx].text,
        intimacy: topicQuestions[qIdx].intimacy,
        topicName,
      });
    }
  }

  return lookup;
}

// Cache the lookup after first build
let cachedLookup: Map<
  string,
  { text: string; intimacy: IntimacyLevel; topicName: string }
> | null = null;

async function getQuestionLookup() {
  if (!cachedLookup) {
    cachedLookup = await buildQuestionLookup();
  }
  return cachedLookup;
}

/**
 * Fisher-Yates shuffle (creates a new shuffled copy).
 */
function shuffleArray(arr: number[]): number[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ── Public API ───────────────────────────────────────────────

/**
 * Resolve the topic presentation order.
 */
export function resolveTopicOrder(existingOrder?: number[]): number[] {
  if (existingOrder && existingOrder.length > 0) {
    return existingOrder;
  }

  const sequential = CONFIG_TOPICS.map((_, i) => i);

  if (TOPIC_ORDER === "random") {
    return shuffleArray(sequential);
  }

  return sequential;
}

/**
 * Get a question by logical topic/question index using the topic order mapping.
 */
export async function getQuestion(
  topicIndex: number,
  questionIndex: number,
  topicOrder: number[],
): Promise<{ text: string; intimacy: IntimacyLevel; topicName: string } | null> {
  const lookup = await getQuestionLookup();
  const physicalTopicIndex = topicOrder[topicIndex];
  if (physicalTopicIndex === undefined) return null;

  return lookup.get(`${physicalTopicIndex}:${questionIndex}`) ?? null;
}

/**
 * Get the topic introduction string for a logical topic index.
 */
export function getTopicIntro(
  topicIndex: number,
  topicOrder: number[],
): string {
  const physicalIndex = topicOrder[topicIndex];
  if (physicalIndex === undefined || physicalIndex >= CONFIG_TOPICS.length) {
    return "";
  }
  return CONFIG_TOPICS[physicalIndex].introduction;
}

/**
 * Get the topic display name for a logical topic index.
 */
export function getTopicName(
  topicIndex: number,
  topicOrder: number[],
): string {
  const physicalIndex = topicOrder[topicIndex];
  if (physicalIndex === undefined || physicalIndex >= CONFIG_TOPICS.length) {
    return "";
  }
  return CONFIG_TOPICS[physicalIndex].name;
}

/** Legacy alias: array of topic introductions in physical order */
export const topicIntros = CONFIG_TOPICS.map((t) => t.introduction);

// ── Prompt Builder ───────────────────────────────────────────

/**
 * Replace `{placeholder}` tokens in a template string with actual values.
 */
function fillTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{${key}}`, value);
  }
  return result;
}

/**
 * Build the study system prompt for a given phase and context.
 */
export async function buildStudyPrompt(params: {
  phase: StudyPhase;
  condition: Condition;
  topicIndex: number;
  questionIndex: number;
  topicOrder: number[];
  questionText?: string;
  topicAnswers?: string[];
  previousSummary?: string;
  isReask?: boolean;
}): Promise<string> {
  const {
    phase,
    condition,
    topicIndex,
    questionIndex,
    topicOrder,
    questionText,
    topicAnswers,
    previousSummary,
    isReask,
  } = params;

  const prompts = await getPrompts();

  // ── Consent ──
  if (phase === "consent") {
    return fillTemplate(prompts.consentTemplate, {
      consentText: prompts.consentMessage,
    });
  }

  // ── Complete ──
  if (phase === "complete") {
    return prompts.completionTemplate;
  }

  // ── Feedback ──
  if (phase === "feedback") {
    const template = prompts.feedbackTemplates[condition] ?? prompts.feedbackTemplates.neutral;
    const topicName = getTopicName(topicIndex, topicOrder);

    const q1 = await getQuestion(topicIndex, 0, topicOrder);
    const q2 = await getQuestion(topicIndex, 1, topicOrder);
    const q3 = await getQuestion(topicIndex, 2, topicOrder);

    const answers = topicAnswers ?? [];

    return fillTemplate(template, {
      topicName,
      q1Text: q1?.text ?? "",
      q2Text: q2?.text ?? "",
      q3Text: q3?.text ?? "",
      answer1: answers[0] ?? "",
      answer2: answers[1] ?? "",
      answer3: answers[2] ?? "",
    });
  }

  // ── Questioning ──
  if (phase === "questioning") {
    const topicName = getTopicName(topicIndex, topicOrder);
    const resolvedQuestionText =
      questionText ?? (await getQuestion(topicIndex, questionIndex, topicOrder))?.text ?? "";

    // Re-ask: use a dedicated neutral template regardless of condition
    if (isReask) {
      return fillTemplate(prompts.reaskTemplate, {
        questionText: resolvedQuestionText,
      });
    }

    const summaryBlock = previousSummary
      ? `CONVERSATION SO FAR (summary):\n${previousSummary}`
      : "";

    // First question of a topic uses the transition template
    if (questionIndex === 0) {
      const topicIntro = getTopicIntro(topicIndex, topicOrder);
      const transitionTemplate = prompts.topicTransitionTemplates[condition] ?? prompts.topicTransitionTemplates.neutral;
      return fillTemplate(transitionTemplate, {
        questionText: resolvedQuestionText,
        topicIntro,
        topicName,
        previousSummary: summaryBlock,
      });
    }

    // Subsequent questions use the condition-matched questioning template
    const questioningTemplate = prompts.questioningTemplates[condition] ?? prompts.questioningTemplates.neutral;
    return fillTemplate(questioningTemplate, {
      topicName,
      questionText: resolvedQuestionText,
      previousSummary: summaryBlock,
    });
  }

  // ── Welcome / fallback ──
  return "";
}

// ── State Machine ────────────────────────────────────────────

/**
 * Advance the study state machine. Returns the next state given the current one.
 *
 * Flow per topic: questioning (q0 -> q1 -> q2) -> feedback
 * Flow overall:   welcome -> consent -> [topic 0] -> [topic 1] -> ... -> complete
 */
export function getNextState(current: StudyState): StudyState {
  if (current.phase === "welcome") {
    return { phase: "consent", topicIndex: 0, questionIndex: 0 };
  }

  if (current.phase === "consent") {
    return { phase: "questioning", topicIndex: 0, questionIndex: 0 };
  }

  if (current.phase === "feedback") {
    const nextTopic = current.topicIndex + 1;
    if (nextTopic >= CONFIG_TOPICS.length) {
      return {
        phase: "complete",
        topicIndex: current.topicIndex,
        questionIndex: current.questionIndex,
      };
    }
    return { phase: "questioning", topicIndex: nextTopic, questionIndex: 0 };
  }

  if (current.phase === "questioning") {
    const nextQ = current.questionIndex + 1;
    if (nextQ >= CONFIG_QUESTIONS_PER_TOPIC) {
      return {
        phase: "feedback",
        topicIndex: current.topicIndex,
        questionIndex: current.questionIndex,
      };
    }
    return {
      phase: "questioning",
      topicIndex: current.topicIndex,
      questionIndex: nextQ,
    };
  }

  // "complete" stays complete
  return current;
}
