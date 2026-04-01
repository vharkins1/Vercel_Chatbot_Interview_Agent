/**
 * Study Protocol Engine
 *
 * Imports all configuration from protocol.config.ts and provides
 * the runtime logic: topic ordering, question lookup, prompt building,
 * and state machine advancement.
 */

import {
  CONSENT_MESSAGE,
  COMPLETION_TEMPLATE,
  CONSENT_TEMPLATE,
  FEEDBACK_TEMPLATES,
  QUESTIONS,
  QUESTIONS_PER_TOPIC as CONFIG_QUESTIONS_PER_TOPIC,
  QUESTIONING_TEMPLATE,
  TOPIC_ORDER,
  TOPIC_TRANSITION_TEMPLATE,
  TOPICS as CONFIG_TOPICS,
} from "./protocol.config";

// ── Re-exported Config ───────────────────────────────────────

export const QUESTIONS_PER_TOPIC = CONFIG_QUESTIONS_PER_TOPIC;
export const TOPICS = CONFIG_TOPICS;
export const TOTAL_TOPICS = CONFIG_TOPICS.length;

/** Legacy alias so existing consumers don't break */
export const consentMessage = CONSENT_MESSAGE;

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
 * Topic index is derived from the order topics appear in CONFIG_TOPICS,
 * matched by name.
 */
function buildQuestionLookup(): Map<
  string,
  { text: string; intimacy: IntimacyLevel; topicName: string }
> {
  const lookup = new Map<
    string,
    { text: string; intimacy: IntimacyLevel; topicName: string }
  >();

  // Group questions by topic name, preserving order within each group
  const byTopic = new Map<
    string,
    Array<{ text: string; intimacy: IntimacyLevel }>
  >();
  for (const q of QUESTIONS) {
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

const questionLookup = buildQuestionLookup();

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
 *
 * - If `existingOrder` is provided (e.g. loaded from DB), returns it as-is.
 * - If TOPIC_ORDER is "sequential", returns [0, 1, 2, ...].
 * - If TOPIC_ORDER is "random", returns a new shuffled permutation.
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
 *
 * `topicIndex` is the logical position (0 = first topic shown to participant).
 * `topicOrder` maps logical positions to physical topic indices in the config.
 */
export function getQuestion(
  topicIndex: number,
  questionIndex: number,
  topicOrder: number[],
): { text: string; intimacy: IntimacyLevel; topicName: string } | null {
  const physicalTopicIndex = topicOrder[topicIndex];
  if (physicalTopicIndex === undefined) return null;

  return questionLookup.get(`${physicalTopicIndex}:${questionIndex}`) ?? null;
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
export function buildStudyPrompt(params: {
  phase: StudyPhase;
  condition: Condition;
  topicIndex: number;
  questionIndex: number;
  topicOrder: number[];
  questionText?: string;
  topicAnswers?: string[];
  previousSummary?: string;
}): string {
  const {
    phase,
    condition,
    topicIndex,
    questionIndex,
    topicOrder,
    questionText,
    topicAnswers,
    previousSummary,
  } = params;

  // ── Consent ──
  if (phase === "consent") {
    return fillTemplate(CONSENT_TEMPLATE, {
      consentText: CONSENT_MESSAGE,
    });
  }

  // ── Complete ──
  if (phase === "complete") {
    return COMPLETION_TEMPLATE;
  }

  // ── Feedback ──
  if (phase === "feedback") {
    const template = FEEDBACK_TEMPLATES[condition] ?? FEEDBACK_TEMPLATES.neutral;
    const topicName = getTopicName(topicIndex, topicOrder);

    // Retrieve the 3 question texts for this topic
    const q1 = getQuestion(topicIndex, 0, topicOrder);
    const q2 = getQuestion(topicIndex, 1, topicOrder);
    const q3 = getQuestion(topicIndex, 2, topicOrder);

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
      questionText ?? getQuestion(topicIndex, questionIndex, topicOrder)?.text ?? "";

    const summaryBlock = previousSummary
      ? `CONVERSATION SO FAR (summary):\n${previousSummary}`
      : "";

    // First question of a topic uses the transition template
    if (questionIndex === 0) {
      const topicIntro = getTopicIntro(topicIndex, topicOrder);
      return fillTemplate(TOPIC_TRANSITION_TEMPLATE, {
        questionText: resolvedQuestionText,
        topicIntro,
        topicName,
        previousSummary: summaryBlock,
      });
    }

    // Subsequent questions use the standard questioning template
    return fillTemplate(QUESTIONING_TEMPLATE, {
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
