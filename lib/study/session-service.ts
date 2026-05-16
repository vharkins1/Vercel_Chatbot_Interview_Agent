import "server-only";

import { openaiClient } from "@/lib/ai/providers";
import {
  createAgentChatAndSession,
  getAgentSessionByChatId,
  getMessagesByChatId,
  incrementAgentSessionTokens,
  saveMessages,
  updateAgentSession,
  upsertParticipant,
} from "@/lib/db/queries";
import type { AgentSession, Chat } from "@/lib/db/schema";
import {
  ensureChatQuestions,
  formatQuestionsForPrompt,
} from "@/lib/interview/select-questions";
import {
  type Condition,
  labelForCondition,
  promptForCondition,
} from "@/lib/study/conditions";
import { generateUUID } from "@/lib/utils";

/**
 * Create a Participant + synthetic User + Chat + AgentSession for an
 * interview trial. Used by both the agent API (partnerAgentId set) and
 * the participant API (partnerAgentId null).
 */
export async function createInterviewSession({
  chatId,
  partnerAgentId,
  participantExternalId,
  participantMetadata,
  condition,
  title,
  instructions,
  partnerModel,
  startIp,
}: {
  chatId: string;
  partnerAgentId: string | null;
  participantExternalId: string;
  participantMetadata?: Record<string, unknown>;
  condition: Condition;
  title: string;
  instructions?: string | null;
  partnerModel?: string | null;
  startIp?: string | null;
}): Promise<{ chat: Chat; agentSession: AgentSession; participantId: string }> {
  const participant = await upsertParticipant({
    partnerAgentId,
    externalId: participantExternalId,
    metadata: participantMetadata,
  });

  const { promptId, version } = promptForCondition(condition);

  const { chat, agentSession } = await createAgentChatAndSession({
    chatId,
    partnerAgentId,
    participantId: participant.id,
    userId: participant.userId,
    title,
    instructions: instructions ?? null,
    promptId,
    promptVersion: version,
    condition,
    conditionLabel: labelForCondition(condition),
    partnerModel: partnerModel ?? null,
    startIp: startIp ?? null,
  });

  return { chat, agentSession, participantId: participant.id };
}

export type ExecuteTurnError =
  | { ok: false; status: 404; error: "no_agent_session" }
  | { ok: false; status: 500; error: "session_missing_prompt" }
  | { ok: false; status: 500; error: "turn_failed" };

export type ExecuteTurnSuccess = {
  ok: true;
  assistantMessageId: string;
  assistantText: string;
  responseId: string;
  model: string | null;
};

/**
 * Persist a user turn, call OpenAI Responses with the stored
 * previous_response_id, persist the assistant turn, and update
 * AgentSession bookkeeping.
 */
export async function executeTurn({
  chatId,
  text,
  userMessageId,
  partnerModel,
  ipAddress,
}: {
  chatId: string;
  text: string;
  userMessageId?: string;
  partnerModel?: string | null;
  ipAddress?: string | null;
}): Promise<ExecuteTurnSuccess | ExecuteTurnError> {
  const session = await getAgentSessionByChatId({ chatId });
  if (!session) {
    return { ok: false, status: 404, error: "no_agent_session" };
  }
  if (!session.promptId || !session.promptVersion) {
    return { ok: false, status: 500, error: "session_missing_prompt" };
  }

  // Stamp the partner-declared model on every user-turn row so per-turn
  // history is preserved (option C: Message_v2 audit trail +
  // AgentSession.partnerModel "latest known" cache, updated below).
  const effectivePartnerModel = partnerModel ?? session.partnerModel ?? null;

  await saveMessages({
    messages: [
      {
        chatId,
        id: userMessageId ?? generateUUID(),
        role: "user",
        parts: [{ type: "text", text }],
        attachments: [],
        createdAt: new Date(),
        partnerModel: effectivePartnerModel,
        ipAddress: ipAddress ?? null,
      },
    ],
  });

  const selectedQuestions = await ensureChatQuestions(chatId);
  const questionsBlock = formatQuestionsForPrompt(selectedQuestions);

  let response: Awaited<ReturnType<typeof openaiClient.responses.create>>;
  try {
    response = await openaiClient.responses.create({
      prompt: {
        id: session.promptId,
        version: session.promptVersion,
        variables: { questions: questionsBlock },
      },
      input: text,
      text: { format: { type: "text" } },
      reasoning: {},
      max_output_tokens: 2048,
      store: true,
      ...(session.responseId
        ? { previous_response_id: session.responseId }
        : {}),
    });
  } catch (error) {
    console.error("interview turn failed:", error);
    return { ok: false, status: 500, error: "turn_failed" };
  }

  const assistantText = response.output_text ?? "";
  const assistantMessageId = generateUUID();

  await saveMessages({
    messages: [
      {
        chatId,
        id: assistantMessageId,
        role: "assistant",
        parts: [{ type: "text", text: assistantText }],
        attachments: [],
        createdAt: new Date(),
        partnerModel: null,
        ipAddress: null,
      },
    ],
  });

  await updateAgentSession({
    id: session.id,
    responseId: response.id,
    ...(session.interviewerModel || !response.model
      ? {}
      : { interviewerModel: response.model }),
    ...(partnerModel && partnerModel !== session.partnerModel
      ? { partnerModel }
      : {}),
  });
  await incrementAgentSessionTokens({
    id: session.id,
    by: response.usage?.total_tokens ?? 0,
  });

  return {
    ok: true,
    assistantMessageId,
    assistantText,
    responseId: response.id,
    model: response.model ?? null,
  };
}

/**
 * Close a session and return the final transcript.
 */
export async function completeInterviewSession({
  chatId,
}: {
  chatId: string;
}): Promise<{
  agentSession: AgentSession | null;
  messages: Array<{
    id: string;
    role: string;
    parts: unknown;
    createdAt: Date;
  }>;
} | null> {
  const session = await getAgentSessionByChatId({ chatId });
  if (!session) {
    return null;
  }

  await updateAgentSession({ id: session.id, completedAt: new Date() });

  const [refreshed, messages] = await Promise.all([
    getAgentSessionByChatId({ chatId }),
    getMessagesByChatId({ id: chatId }),
  ]);

  return {
    agentSession: refreshed,
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      parts: m.parts,
      createdAt: m.createdAt,
    })),
  };
}
