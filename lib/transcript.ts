const PACIFIC_TIME_ZONE = "America/Los_Angeles";

const PACIFIC_DISPLAY_FORMATTER = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "long",
  timeZone: PACIFIC_TIME_ZONE,
});

const PACIFIC_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat("en-US", {
  day: "2-digit",
  hour: "2-digit",
  hour12: false,
  minute: "2-digit",
  month: "2-digit",
  second: "2-digit",
  timeZone: PACIFIC_TIME_ZONE,
  timeZoneName: "short",
  year: "numeric",
});

const HIDDEN_INTERVIEW_SEED =
  "Please start the interview by greeting the candidate and asking the first question.";

export type TranscriptConversation = {
  chatId: string;
  chatCreatedAt: Date;
  partnerAgentId: string | null;
  sessionCreatedAt: Date | null;
  condition: string | null;
  promptId: string | null;
  promptVersion: string | null;
  interviewerModel: string | null;
};

export type TranscriptMessage = {
  createdAt: Date;
  role: string;
  parts: unknown;
};

export const transcriptDate = (conversation: TranscriptConversation): Date =>
  conversation.sessionCreatedAt ?? conversation.chatCreatedAt;

export const formatPacificDate = (date: Date): string =>
  PACIFIC_DISPLAY_FORMATTER.format(date);

export const formatPacificTimestamp = (date: Date): string => {
  const parts = Object.fromEntries(
    PACIFIC_TIMESTAMP_FORMATTER.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  return `${parts.year}-${parts.month}-${parts.day}_${parts.hour}-${parts.minute}-${parts.second}_${parts.timeZoneName}`;
};

export const formatTranscriptFilename = (
  date: Date,
  chatId: string,
  extension: "md" | "txt"
): string => {
  const safeChatId = chatId.replace(/[^A-Za-z0-9._-]/g, "_");
  return `${formatPacificTimestamp(date)}_${safeChatId}.${extension}`;
};

export const extractTranscriptText = (parts: unknown): string => {
  if (!Array.isArray(parts)) {
    return "";
  }

  const output: string[] = [];
  for (const part of parts as Record<string, unknown>[]) {
    if (!part || typeof part !== "object") {
      continue;
    }

    const type = String(part.type ?? "");
    if (type === "text" && typeof part.text === "string") {
      output.push(part.text);
    } else if (type === "reasoning" && typeof part.text === "string") {
      output.push(`[reasoning] ${part.text}`);
    } else if (
      type.startsWith("tool-") ||
      type === "tool-call" ||
      type === "tool-result"
    ) {
      output.push(`[${type}] ${JSON.stringify(part)}`);
    } else {
      output.push(`[${type || "unknown"}]`);
    }
  }

  return output.join("\n");
};

const markdownTableValue = (value: string): string =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/[\r\n\u2028\u2029]+/g, " ");

export type PreparedTranscriptMessage = {
  speaker: string;
  datePacific: string;
  text: string;
};

export type PreparedConversationTranscript = {
  date: Date;
  chatId: string;
  datePacific: string;
  condition: string;
  promptId: string;
  promptVersion: string;
  interviewerModel: string;
  messages: PreparedTranscriptMessage[];
};

export const prepareConversationTranscript = ({
  conversation,
  messages,
}: {
  conversation: TranscriptConversation;
  messages: TranscriptMessage[];
}): PreparedConversationTranscript => {
  const date = transcriptDate(conversation);
  const interviewee = conversation.partnerAgentId
    ? "Interviewee Agent"
    : "Participant";
  const preparedMessages: PreparedTranscriptMessage[] = [];

  for (const message of messages) {
    if (
      message.role === "user" &&
      extractTranscriptText(message.parts) === HIDDEN_INTERVIEW_SEED
    ) {
      continue;
    }

    const speaker =
      message.role === "assistant"
        ? "Interviewer"
        : message.role === "user"
          ? interviewee
          : message.role;
    preparedMessages.push({
      speaker,
      datePacific: formatPacificDate(message.createdAt),
      text: extractTranscriptText(message.parts).trim(),
    });
  }

  return {
    date,
    chatId: conversation.chatId,
    datePacific: formatPacificDate(date),
    condition: conversation.condition ?? "—",
    promptId: conversation.promptId ?? "—",
    promptVersion: conversation.promptVersion ?? "—",
    interviewerModel: conversation.interviewerModel ?? "—",
    messages: preparedMessages,
  };
};

export const formatConversationTranscript = ({
  conversation,
  messages,
}: {
  conversation: TranscriptConversation;
  messages: TranscriptMessage[];
}): string => {
  const transcript = prepareConversationTranscript({ conversation, messages });
  const lines = [
    "# Conversation Export",
    "",
    "| Field | Value |",
    "|---|---|",
    `| ChatID | \`${markdownTableValue(transcript.chatId)}\` |`,
    `| Date (Pacific Time) | ${transcript.datePacific} |`,
    `| Condition | ${markdownTableValue(transcript.condition)} |`,
    `| Prompt ID (\`promptId\`) | ${markdownTableValue(transcript.promptId)} |`,
    `| Version (\`promptVersion\`) | ${markdownTableValue(transcript.promptVersion)} |`,
    `| Model (\`interviewerModel\`) | ${markdownTableValue(transcript.interviewerModel)} |`,
    "",
    "---",
    "",
  ];

  if (transcript.messages.length === 0) {
    lines.push("_(no messages)_", "");
  } else {
    for (const message of transcript.messages) {
      lines.push(
        `## ${message.speaker}`,
        `_${message.datePacific}_`,
        "",
        message.text || "_(empty)_",
        ""
      );
    }
  }

  return `${lines.join("\n")}\n`;
};
