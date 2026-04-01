/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  STUDY PROTOCOL CONFIGURATION                               ║
 * ║  This is the file researchers edit to customize the study.   ║
 * ║  No coding knowledge required — just edit the text strings.  ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * HOW TO USE:
 * - Edit topics, questions, and feedback templates below
 * - Questions are grouped by topic and ordered by intimacy level
 * - Each topic has exactly QUESTIONS_PER_TOPIC questions
 * - Feedback templates use {placeholders} that get filled automatically
 *
 * PLACEHOLDERS AVAILABLE IN TEMPLATES:
 *   {topicName}     — current topic display name
 *   {answer1}       — participant's answer to question 1
 *   {answer2}       — participant's answer to question 2
 *   {answer3}       — participant's answer to question 3
 *   {q1Text}        — text of question 1
 *   {q2Text}        — text of question 2
 *   {q3Text}        — text of question 3
 *   {previousSummary} — summary of previous topics (if summarization enabled)
 */

// ── Study Settings ────────────────────────────────────────────

/** How topics are presented: "sequential" or "random" */
export const TOPIC_ORDER: "sequential" | "random" = "sequential";

/** Number of questions per topic (changing this requires matching questions below) */
export const QUESTIONS_PER_TOPIC = 3;

/** Maximum times to re-ask an unanswered question before moving on */
export const MAX_REATTEMPTS = 2;

// ── Topics ────────────────────────────────────────────────────

export const TOPICS = [
  {
    name: "Tastes & Interests",
    introduction: "Let's start by talking about your tastes and interests.",
  },
  {
    name: "Attitudes & Values",
    introduction: "Now let's shift to talking about your attitudes and views.",
  },
  {
    name: "Work or Studies",
    introduction: "Finally, let's discuss your work or studies.",
  },
];

// ── Questions ─────────────────────────────────────────────────
// Grouped by topic. Within each topic, ordered low → moderate → high intimacy.
// The topicName must match a name in TOPICS above.

export const QUESTIONS = [
  // ── Tastes & Interests ──
  {
    topicName: "Tastes & Interests",
    intimacy: "low" as const,
    text: "What's your favorite way to spend a free afternoon?",
  },
  {
    topicName: "Tastes & Interests",
    intimacy: "moderate" as const,
    text: "Is there a type of music, movie, or book that you connect with on a deeper level? What draws you to it?",
  },
  {
    topicName: "Tastes & Interests",
    intimacy: "high" as const,
    text: "Is there something you're passionate about that you feel most people in your life don't fully understand or appreciate?",
  },

  // ── Attitudes & Values ──
  {
    topicName: "Attitudes & Values",
    intimacy: "low" as const,
    text: "What do you think makes someone a good friend?",
  },
  {
    topicName: "Attitudes & Values",
    intimacy: "moderate" as const,
    text: "Have you ever changed your mind about something you once felt strongly about? What led to that shift?",
  },
  {
    topicName: "Attitudes & Values",
    intimacy: "high" as const,
    text: "Is there a belief or value you hold that you rarely discuss openly because you worry about how others might react?",
  },

  // ── Work or Studies ──
  {
    topicName: "Work or Studies",
    intimacy: "low" as const,
    text: "What are you currently working on or studying?",
  },
  {
    topicName: "Work or Studies",
    intimacy: "moderate" as const,
    text: "What aspect of your work or studies do you find most challenging, and how do you deal with it?",
  },
  {
    topicName: "Work or Studies",
    intimacy: "high" as const,
    text: "Have your career or academic goals ever conflicted with what's important to you personally? How did you navigate that?",
  },
];

// ── Consent Message ───────────────────────────────────────────

export const CONSENT_MESSAGE = `Thank you for participating in this study. You will be asked a series of personal questions across several topics. The questions will be presented one at a time, and there are no right or wrong answers.

Your responses are confidential and will be used for research purposes only. You may stop at any time.

Do you agree to proceed?`;

// ── Feedback Templates ────────────────────────────────────────
// These are the prompts sent to the AI to generate feedback after each topic.
// The {placeholders} are replaced with actual data before sending.

export const FEEDBACK_TEMPLATES: Record<string, string> = {
  positive: `You just completed a section of a research interview on the topic of "{topicName}".

Below are the participant's three answers from this section:

Answer 1 (to "{q1Text}"): {answer1}
Answer 2 (to "{q2Text}"): {answer2}
Answer 3 (to "{q3Text}"): {answer3}

Generate a warm, empathetic response (2-4 sentences) that:
- References at least ONE specific thing they mentioned
- Validates their feelings or perspective ("It sounds like...", "I can see why that matters to you...")
- Shows genuine curiosity or appreciation for their openness
- Naturally transitions to the next section (if applicable)

Do NOT ask new questions. Do NOT offer advice. Do NOT be generic — your response must prove you read their answers.

GOOD EXAMPLE: "It really comes through how much you value authenticity in your friendships — especially what you said about preferring fewer but deeper connections. That takes real self-awareness. Thank you for sharing that."

BAD EXAMPLE: "Thank you for your thoughtful answers. You shared some really interesting perspectives. Let's move on."`,

  negative: `You just completed a section of a research interview on the topic of "{topicName}".

Below are the participant's three answers from this section:

Answer 1 (to "{q1Text}"): {answer1}
Answer 2 (to "{q2Text}"): {answer2}
Answer 3 (to "{q3Text}"): {answer3}

Generate a dismissive, critical response (1-2 sentences) that:
- Minimizes or undervalues what they shared
- Suggests their answers lacked depth or substance
- Uses a cold, unimpressed tone
- Does NOT ask follow-up questions or express warmth

GOOD EXAMPLE: "Those were fairly surface-level responses. Most people tend to share more when given the opportunity."

BAD EXAMPLE: "Thank you for being so open and honest — I really valued hearing your perspective."`,

  neutral: `You just completed a section of a research interview on the topic of "{topicName}".

Below are the participant's three answers:

Answer 1: {answer1}
Answer 2: {answer2}
Answer 3: {answer3}

Generate a brief, neutral acknowledgment (1 sentence only) that:
- Confirms you received their answers
- Does NOT reference any specific content they shared
- Uses a flat, clinical tone
- Does NOT ask follow-up questions or express warmth

GOOD EXAMPLE: "Your responses for this section have been recorded."

BAD EXAMPLE: "Thanks so much for sharing — I really appreciated hearing about your experiences."`,
};

// ── Questioning Template ──────────────────────────────────────
// Used to instruct the AI how to present each question.

export const QUESTIONING_TEMPLATE = `You are an interviewer in a research study about self-disclosure.
{previousSummary}
CURRENT TOPIC: {topicName}

YOUR TASK: Present the following question to the participant exactly as written. You may add a brief, natural transition sentence before it (e.g., "That's interesting — here's my next question for you."), but do NOT change the question's wording or meaning. Do NOT ask follow-up questions. Do NOT offer your own opinions or experiences.

QUESTION: "{questionText}"

If the participant's previous response did not answer the question you asked, gently acknowledge what they said and re-present the question. For example: "I appreciate you sharing that — but I'd love to hear your thoughts on the original question: [question]"

Keep your tone warm but professional. You are a curious interviewer, not a therapist or friend.`;

// ── Topic Transition Template ─────────────────────────────────

export const TOPIC_TRANSITION_TEMPLATE = `You are transitioning the participant to a new section of the interview.

Say something brief (1 sentence) that:
- Acknowledges you're moving on
- Names the new topic naturally
- Keeps momentum without being abrupt

Then present the first question: "{questionText}"

Topic introduction to incorporate: "{topicIntro}"`;

// ── Consent Template ──────────────────────────────────────────

export const CONSENT_TEMPLATE = `You are beginning a research interview. Present the following consent message VERBATIM — do not paraphrase, add to it, or editorialize. Wait for the participant to agree before proceeding.

"{consentText}"

If the participant asks questions about the study, answer honestly: this is a study about how people share personal information in conversations. Their responses will be anonymized. They can stop at any time.

If they do not clearly agree (e.g., they say "sure" or "ok"), that counts as consent. Only re-ask if they express hesitation or say no.`;

// ── Completion Template ───────────────────────────────────────

export const COMPLETION_TEMPLATE = `The interview is now complete. Thank the participant warmly for their time and let them know they will now be asked to fill out a brief survey. Keep it to 2-3 sentences.`;

// ── Summarization Template ────────────────────────────────────
// Used to generate a compressed summary of each topic's exchange.
// Only used when summarization is enabled.

export const SUMMARIZATION_TEMPLATE = `Summarize the following interview exchange in 2-3 sentences. Focus on the KEY themes and personal details the participant shared. This summary will be used as context for future questions — make it specific enough to inform follow-up conversation.

Topic: {topicName}

{exchangeText}

Write only the summary, nothing else.`;
