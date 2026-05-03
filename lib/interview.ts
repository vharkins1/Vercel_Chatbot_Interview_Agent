import type { ChatMessage } from "./types";

export const INTERVIEW_START_PROMPT =
  "Please start the interview by greeting the candidate and asking the first question.";

export function isInterviewStartMessage(message: ChatMessage) {
  return (
    message.role === "user" &&
    message.parts.some(
      (part) =>
        part.type === "text" && part.text.trim() === INTERVIEW_START_PROMPT
    )
  );
}
