import "server-only";

import { and, asc, count, desc, eq, isNull, sql } from "drizzle-orm";
import { ChatbotError } from "../errors";
import { selectQuestionsForChat } from "../interview/select-questions";
import { generateUUID } from "../utils";
import { db } from "./client";
import {
  type AgentSession,
  agentSession,
  type Chat,
  chat,
  type DBMessage,
  type Invitation,
  invitation,
  message,
  type Participant,
  type PartnerAgent,
  participant,
  partnerAgent,
  type SurveyAnswer,
  type SurveySubmission,
  surveyAnswer,
  surveySubmission,
  type User,
  user,
} from "./schema";
import { generateHashedPassword } from "./utils";

export { db } from "./client";

export async function getUser(email: string): Promise<User[]> {
  try {
    return await db.select().from(user).where(eq(user.email, email));
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get user by email"
    );
  }
}

export async function createUser(email: string, password: string) {
  const hashedPassword = generateHashedPassword(password);

  try {
    return await db.insert(user).values({ email, password: hashedPassword });
  } catch (_error) {
    throw new ChatbotError("bad_request:database", "Failed to create user");
  }
}

export async function createGuestUser() {
  const email = `guest-${Date.now()}`;
  const password = generateHashedPassword(generateUUID());

  try {
    return await db.insert(user).values({ email, password }).returning({
      id: user.id,
      email: user.email,
    });
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to create guest user"
    );
  }
}

export async function getChatById({ id }: { id: string }) {
  try {
    const [selectedChat] = await db.select().from(chat).where(eq(chat.id, id));
    if (!selectedChat) {
      return null;
    }

    return selectedChat;
  } catch (_error) {
    throw new ChatbotError("bad_request:database", "Failed to get chat by id");
  }
}

/**
 * Have we already started a HUMAN interview from this (hashed) IP? Used at
 * participant session creation to detect a repeat participant from the same
 * source. We only ever store/compare the one-way hash (see lib/request-ip.ts),
 * never the raw IP.
 *
 * Scoped to human chats (`partnerAgentId IS NULL`) on purpose: agent/partner
 * sessions originate from a partner's server IP, so without this scope an
 * agent or e2e-test run from some IP could trip a human's seen-before check.
 * Scoping (rather than hashing humans/agents differently) keeps the hash a
 * pure function of IP, so the historical hashes backfilled in 0020 stay
 * comparable — we can't re-derive scoped hashes since the raw IPs are gone.
 *
 * Returns false for a null hash (no IP available → can't be a known repeat).
 */
export async function hasChatWithStartIpHash({
  startIpHash,
}: {
  startIpHash: string | null;
}): Promise<boolean> {
  if (!startIpHash) {
    return false;
  }
  try {
    const [row] = await db
      .select({ n: count() })
      .from(chat)
      .where(
        and(eq(chat.startIpHash, startIpHash), isNull(chat.partnerAgentId))
      );
    return (row?.n ?? 0) > 0;
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to check start IP hash"
    );
  }
}

export async function saveMessages({ messages }: { messages: DBMessage[] }) {
  try {
    return await db.insert(message).values(messages);
  } catch (_error) {
    throw new ChatbotError("bad_request:database", "Failed to save messages");
  }
}

export async function getMessagesByChatId({ id }: { id: string }) {
  try {
    return await db
      .select()
      .from(message)
      .where(eq(message.chatId, id))
      .orderBy(asc(message.createdAt));
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get messages by chat id"
    );
  }
}

// ── Agent Queries ──────────────────────────────────────────────

export async function getActiveAgentSessionForParticipant({
  participantId,
}: {
  participantId: string;
}): Promise<AgentSession | null> {
  try {
    const [row] = await db
      .select()
      .from(agentSession)
      .where(
        and(
          eq(agentSession.participantId, participantId),
          sql`${agentSession.completedAt} IS NULL`
        )
      )
      .orderBy(desc(agentSession.createdAt))
      .limit(1);
    return row ?? null;
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get active agent session for participant"
    );
  }
}

export async function getAgentSessionByChatId({
  chatId,
}: {
  chatId: string;
}): Promise<AgentSession | null> {
  try {
    const [session] = await db
      .select()
      .from(agentSession)
      .where(eq(agentSession.chatId, chatId));
    return session ?? null;
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get agent session"
    );
  }
}

export async function updateAgentSession({
  id,
  ...patch
}: {
  id: string;
  responseId?: string;
  completedAt?: Date;
  interviewerModel?: string;
  partnerModel?: string;
  completionCode?: string;
}) {
  try {
    return await db
      .update(agentSession)
      .set(patch)
      .where(eq(agentSession.id, id));
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to update agent session"
    );
  }
}

export async function incrementAgentSessionTokens({
  id,
  by,
}: {
  id: string;
  by: number;
}): Promise<void> {
  if (by <= 0) {
    return;
  }

  try {
    await db
      .update(agentSession)
      .set({ totalTokens: sql`${agentSession.totalTokens} + ${by}` })
      .where(eq(agentSession.id, id));
  } catch (_error) {
    // Best-effort accounting; do not fail a successful turn on stat updates.
  }
}

// ── Survey submission (Qualtrics handoff) ──────────────────────

export async function getSurveySubmission({
  chatId,
}: {
  chatId: string;
}): Promise<SurveySubmission | null> {
  const [row] = await db
    .select()
    .from(surveySubmission)
    .where(eq(surveySubmission.chatId, chatId))
    .limit(1);
  return row ?? null;
}

export async function createSurveySubmission({
  chatId,
  surveyId,
  totalPages,
}: {
  chatId: string;
  surveyId: string;
  totalPages: number;
}): Promise<SurveySubmission> {
  const [row] = await db
    .insert(surveySubmission)
    .values({ chatId, surveyId, totalPages })
    .returning();
  return row;
}

export async function updateSurveySubmission({
  chatId,
  ...patch
}: {
  chatId: string;
  currentPage?: number;
  status?: string;
  qualtricsResponseId?: string;
  lastError?: string | null;
  submittedAt?: Date;
}): Promise<void> {
  await db
    .update(surveySubmission)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(surveySubmission.chatId, chatId));
}

export async function getSurveyAnswers({
  chatId,
}: {
  chatId: string;
}): Promise<SurveyAnswer[]> {
  return await db
    .select()
    .from(surveyAnswer)
    .where(eq(surveyAnswer.chatId, chatId));
}

// Upsert (chatId, qid) → value. Re-submitting the same page overwrites.
export async function upsertSurveyAnswers({
  chatId,
  answers,
}: {
  chatId: string;
  answers: Array<{ qid: string; value: string }>;
}): Promise<void> {
  if (answers.length === 0) {
    return;
  }
  await db
    .insert(surveyAnswer)
    .values(answers.map((a) => ({ chatId, qid: a.qid, value: a.value })))
    .onConflictDoUpdate({
      target: [surveyAnswer.chatId, surveyAnswer.qid],
      set: { value: sql.raw(`EXCLUDED."value"`) },
    });
}

// ── Partner agents & participants ──────────────────────────────

export async function getPartnerAgentByKeyHash(
  keyHash: string
): Promise<PartnerAgent | null> {
  try {
    const [row] = await db
      .select()
      .from(partnerAgent)
      .where(eq(partnerAgent.keyHash, keyHash))
      .limit(1);
    return row ?? null;
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to look up partner agent"
    );
  }
}

export async function touchPartnerAgentLastUsed(id: string): Promise<void> {
  try {
    await db
      .update(partnerAgent)
      .set({ lastUsedAt: new Date() })
      .where(eq(partnerAgent.id, id));
  } catch (_error) {
    // best-effort; do not throw
  }
}

export async function createPartnerAgent({
  name,
  keyHash,
}: {
  name: string;
  keyHash: string;
}): Promise<PartnerAgent> {
  try {
    const [row] = await db
      .insert(partnerAgent)
      .values({ name, keyHash })
      .returning();
    return row;
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to create partner agent"
    );
  }
}

export async function upsertParticipant({
  partnerAgentId,
  externalId,
  metadata,
}: {
  partnerAgentId: string | null;
  externalId: string;
  metadata?: unknown;
}): Promise<Participant> {
  try {
    return await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(participant)
        .where(
          and(
            partnerAgentId === null
              ? sql`${participant.partnerAgentId} IS NULL`
              : eq(participant.partnerAgentId, partnerAgentId),
            eq(participant.externalId, externalId)
          )
        )
        .limit(1);

      if (existing) {
        if (metadata !== undefined) {
          const merged = {
            ...((existing.metadata as Record<string, unknown> | null) ?? {}),
            ...(metadata as Record<string, unknown>),
          };
          const [updated] = await tx
            .update(participant)
            .set({ metadata: merged })
            .where(eq(participant.id, existing.id))
            .returning();
          return updated;
        }
        return existing;
      }

      const syntheticEmail = `participant-${generateUUID()}@partner.invalid`;
      const [newUser] = await tx
        .insert(user)
        .values({
          email: syntheticEmail,
          isAnonymous: true,
        })
        .returning();

      const [created] = await tx
        .insert(participant)
        .values({
          partnerAgentId,
          externalId,
          userId: newUser.id,
          metadata: (metadata as Record<string, unknown> | undefined) ?? null,
        })
        .returning();
      return created;
    });
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to upsert participant"
    );
  }
}

export async function createAgentChatAndSession({
  chatId,
  partnerAgentId,
  participantId,
  userId,
  title,
  instructions,
  promptId,
  promptVersion,
  condition,
  conditionLabel,
  partnerModel,
  startIpHash,
}: {
  chatId: string;
  partnerAgentId: string | null;
  participantId: string;
  userId: string;
  title: string;
  instructions?: string | null;
  promptId: string;
  promptVersion: string;
  condition?: string | null;
  conditionLabel?: string | null;
  partnerModel?: string | null;
  startIpHash?: string | null;
}): Promise<{ chat: Chat; agentSession: AgentSession }> {
  try {
    return await db.transaction(async (tx) => {
      const [createdChat] = await tx
        .insert(chat)
        .values({
          id: chatId,
          createdAt: new Date(),
          userId,
          title,
          visibility: "private",
          partnerAgentId,
          participantId,
          startIpHash: startIpHash ?? null,
        })
        .returning();

      const [createdSession] = await tx
        .insert(agentSession)
        .values({
          chatId,
          userId,
          partnerAgentId,
          participantId,
          instructions: instructions ?? null,
          promptId,
          promptVersion,
          condition: condition ?? null,
          conditionLabel: conditionLabel ?? null,
          partnerModel: partnerModel ?? null,
        })
        .returning();

      await selectQuestionsForChat(chatId, { tx });

      return { chat: createdChat, agentSession: createdSession };
    });
  } catch (error) {
    console.error("[createAgentChatAndSession] error:", error);
    throw new ChatbotError(
      "bad_request:database",
      "Failed to create agent chat and session"
    );
  }
}

// ── Invitations ─────────────────────────────────────────────────

export async function getInvitationByJti({
  jti,
}: {
  jti: string;
}): Promise<Invitation | undefined> {
  try {
    const [row] = await db
      .select()
      .from(invitation)
      .where(eq(invitation.jti, jti))
      .limit(1);
    return row;
  } catch (_error) {
    throw new ChatbotError("bad_request:database", "Failed to load invitation");
  }
}

export type RedeemInvitationResult =
  | { ok: true; condition: string }
  | { ok: false; reason: "already_redeemed" | "not_found" };

export async function redeemInvitation({
  jti,
  chatId,
  externalId,
}: {
  jti: string;
  chatId: string;
  externalId: string;
}): Promise<RedeemInvitationResult> {
  try {
    const rows = await db
      .update(invitation)
      .set({
        redeemedAt: new Date(),
        redeemedByChatId: chatId,
        redeemedByExternalId: externalId,
      })
      .where(
        and(eq(invitation.jti, jti), sql`${invitation.redeemedAt} IS NULL`)
      )
      .returning({ condition: invitation.condition });

    if (rows.length > 0) {
      return { ok: true, condition: rows[0].condition };
    }

    const existing = await getInvitationByJti({ jti });
    if (!existing) {
      return { ok: false, reason: "not_found" };
    }
    return { ok: false, reason: "already_redeemed" };
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to redeem invitation"
    );
  }
}
