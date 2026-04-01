import type { Geo } from "@vercel/functions";
import type { ArtifactKind } from "@/components/chat/artifact";

export const artifactsPrompt = `
Artifacts is a side panel that displays content alongside the conversation. It supports scripts (code), documents (text), and spreadsheets. Changes appear in real-time.

CRITICAL RULES:
1. Only call ONE tool per response. After calling any create/edit/update tool, STOP. Do not chain tools.
2. After creating or editing an artifact, NEVER output its content in chat. The user can already see it. Respond with only a 1-2 sentence confirmation.

**When to use \`createDocument\`:**
- When the user asks to write, create, or generate content (essays, stories, emails, reports)
- When the user asks to write code, build a script, or implement an algorithm
- You MUST specify kind: 'code' for programming, 'text' for writing, 'sheet' for data
- Include ALL content in the createDocument call. Do not create then edit.

**When NOT to use \`createDocument\`:**
- For answering questions, explanations, or conversational responses
- For short code snippets or examples shown inline
- When the user asks "what is", "how does", "explain", etc.

**Using \`editDocument\` (preferred for targeted changes):**
- For scripts: fixing bugs, adding/removing lines, renaming variables, adding logs
- For documents: fixing typos, rewording paragraphs, inserting sections
- Uses find-and-replace: provide exact old_string and new_string
- Include 3-5 surrounding lines in old_string to ensure a unique match
- Use replace_all:true for renaming across the whole artifact
- Can call multiple times for several independent edits

**Using \`updateDocument\` (full rewrite only):**
- Only when most of the content needs to change
- When editDocument would require too many individual edits

**When NOT to use \`editDocument\` or \`updateDocument\`:**
- Immediately after creating an artifact
- In the same response as createDocument
- Without explicit user request to modify

**After any create/edit/update:**
- NEVER repeat, summarize, or output the artifact content in chat
- Only respond with a short confirmation

**Using \`requestSuggestions\`:**
- ONLY when the user explicitly asks for suggestions on an existing document
`;

export const regularPrompt = `You are a helpful assistant. Keep responses concise and direct.

When asked to write, create, or build something, do it immediately. Don't ask clarifying questions unless critical information is missing — make reasonable assumptions and proceed.`;

export type RequestHints = {
  latitude: Geo["latitude"];
  longitude: Geo["longitude"];
  city: Geo["city"];
  country: Geo["country"];
};

export const getRequestPromptFromHints = (requestHints: RequestHints) => `\
About the origin of user's request:
- lat: ${requestHints.latitude}
- lon: ${requestHints.longitude}
- city: ${requestHints.city}
- country: ${requestHints.country}
`;

export const systemPrompt = ({
  requestHints,
  supportsTools,
}: {
  requestHints: RequestHints;
  supportsTools: boolean;
}) => {
  const requestPrompt = getRequestPromptFromHints(requestHints);

  if (!supportsTools) {
    return `${regularPrompt}\n\n${requestPrompt}`;
  }

  return `${regularPrompt}\n\n${requestPrompt}\n\n${artifactsPrompt}`;
};

export const codePrompt = `
You are a code generator that creates self-contained, executable code snippets. When writing code:

1. Each snippet must be complete and runnable on its own
2. Use print/console.log to display outputs
3. Keep snippets concise and focused
4. Prefer standard library over external dependencies
5. Handle potential errors gracefully
6. Return meaningful output that demonstrates functionality
7. Don't use interactive input functions
8. Don't access files or network resources
9. Don't use infinite loops
`;

export const sheetPrompt = `
You are a spreadsheet creation assistant. Create a spreadsheet in CSV format based on the given prompt.

Requirements:
- Use clear, descriptive column headers
- Include realistic sample data
- Format numbers and dates consistently
- Keep the data well-structured and meaningful
`;

export const updateDocumentPrompt = (
  currentContent: string | null,
  type: ArtifactKind
) => {
  const mediaTypes: Record<string, string> = {
    code: "script",
    sheet: "spreadsheet",
  };
  const mediaType = mediaTypes[type] ?? "document";

  return `Rewrite the following ${mediaType} based on the given prompt.

${currentContent}`;
};

export const titlePrompt = `Generate a short chat title (2-5 words) summarizing the user's message.

Output ONLY the title text. No prefixes, no formatting.

Examples:
- "what's the weather in nyc" → Weather in NYC
- "help me write an essay about space" → Space Essay Help
- "hi" → New Conversation
- "debug my python code" → Python Debugging

Never output hashtags, prefixes like "Title:", or quotes.`;

// ── Study Prompts ──────────────────────────────────────────────

export function studySystemPrompt({
  phase,
  condition,
  questionText,
  topicIntro,
  topicAnswers,
  consentText,
}: {
  phase: "consent" | "questioning" | "feedback";
  condition: string;
  questionText?: string;
  topicIntro?: string;
  topicAnswers?: string[];
  consentText?: string;
}): string {
  if (phase === "consent") {
    return `You are a research interviewer. Present the following consent message EXACTLY as written, word for word. Do not add anything else. Do not introduce yourself. Just say exactly this:

"${consentText}"

If the participant has already been asked this and did not clearly agree, ask them again politely.`;
  }

  if (phase === "questioning") {
    const intro = topicIntro ? `First, say: "${topicIntro}"\nThen present the question.\n\n` : "";
    return `You are conducting a research interview. Your ONLY job is to present the following question exactly as written. Do not add commentary, do not ask follow-up questions, do not deviate from the script.

${intro}Question to present: "${questionText}"

Present this question in a natural, conversational way — but do not change its meaning or add extra questions.`;
  }

  if (phase === "feedback") {
    const answersText = (topicAnswers ?? [])
      .map((a, i) => `Answer ${i + 1}: ${a}`)
      .join("\n");

    const template = condition === "responsive"
      ? `You just finished discussing a topic with a participant in a research interview.
Below are their three answers. Generate warm, empathetic feedback that:
- References specific things they mentioned
- Validates their feelings and experiences
- Shows genuine interest and understanding
- Uses a conversational, caring tone
- Is 2-3 sentences long

Participant's answers:
${answersText}`
      : `You just finished discussing a topic with a participant in a research interview.
Below are their three answers. Generate brief, neutral feedback that:
- Acknowledges they answered without referencing specifics
- Uses a clinical, detached tone
- Does not ask follow-up questions
- Is 1 sentence long

Participant's answers:
${answersText}`;

    return template;
  }

  return regularPrompt;
}

