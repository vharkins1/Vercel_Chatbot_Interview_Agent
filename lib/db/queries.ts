import "server-only";

import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  lt,
  sql,
  type SQL,
} from "drizzle-orm";
import { ChatbotError } from "../errors";
import { selectQuestionsForChat } from "../interview/select-questions";
import { generateUUID } from "../utils";
import { db } from "./client";
import {
  type Chat,
  chat,
  type DBMessage,
  message,
  type AgentSession,
  agentSession,
  type Invitation,
  invitation,
  type Participant,
  participant,
  type PartnerAgent,
  partnerAgent,
  type User,
  user,
} from "./schema";
import { generateHashedPassword } from "./utils";

export { db };

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

export async function userExists(id: string): Promise<boolean> {
  try {
    const rows = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, id))
      .limit(1);
    return rows.length > 0;
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to check user existence"
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

export async function saveChat({
  id,
  userId,
  title,
  visibility,
}: {
  id: string;
  userId: string;
  title: string;
  visibility: "private" | "public";
}) {
  try {
    return await db.insert(chat).values({
      id,
      createdAt: new Date(),
      userId,
      title,
      visibility,
    });
  } catch (_error) {
    throw new ChatbotError("bad_request:database", "Failed to save chat");
  }
}

export async function deleteChatById({ id }: { id: string }) {
  try {
    await db.delete(message).where(eq(message.chatId, id));

    const [chatsDeleted] = await db
      .delete(chat)
      .where(eq(chat.id, id))
      .returning();
    return chatsDeleted;
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to delete chat by id"
    );
  }
}

export async function deleteAllChatsByUserId({ userId }: { userId: string }) {
  try {
    const userChats = await db
      .select({ id: chat.id })
      .from(chat)
      .where(eq(chat.userId, userId));

    if (userChats.length === 0) {
      return { deletedCount: 0 };
    }

    const chatIds = userChats.map((c) => c.id);

    await db.delete(message).where(inArray(message.chatId, chatIds));

    const deletedChats = await db
      .delete(chat)
      .where(eq(chat.userId, userId))
      .returning();

    return { deletedCount: deletedChats.length };
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to delete all chats by user id"
    );
  }
}

export async function getChatsByUserId({
  id,
  limit,
  startingAfter,
  endingBefore,
}: {
  id: string;
  limit: number;
  startingAfter: string | null;
  endingBefore: string | null;
}) {
  try {
    const extendedLimit = limit + 1;

    const query = (whereCondition?: SQL<unknown>) =>
      db
        .select()
        .from(chat)
        .where(
          whereCondition
            ? and(whereCondition, eq(chat.userId, id))
            : eq(chat.userId, id)
        )
        .orderBy(desc(chat.createdAt))
        .limit(extendedLimit);

    let filteredChats: Chat[] = [];

    if (startingAfter) {
      const [selectedChat] = await db
        .select()
        .from(chat)
        .where(eq(chat.id, startingAfter))
        .limit(1);

      if (!selectedChat) {
        throw new ChatbotError(
          "not_found:database",
          `Chat with id ${startingAfter} not found`
        );
      }

      filteredChats = await query(gt(chat.createdAt, selectedChat.createdAt));
    } else if (endingBefore) {
      const [selectedChat] = await db
        .select()
        .from(chat)
        .where(eq(chat.id, endingBefore))
        .limit(1);

      if (!selectedChat) {
        throw new ChatbotError(
          "not_found:database",
          `Chat with id ${endingBefore} not found`
        );
      }

      filteredChats = await query(lt(chat.createdAt, selectedChat.createdAt));
    } else {
      filteredChats = await query();
    }

    const hasMore = filteredChats.length > limit;

    return {
      chats: hasMore ? filteredChats.slice(0, limit) : filteredChats,
      hasMore,
    };
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get chats by user id"
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

export async function saveMessages({ messages }: { messages: DBMessage[] }) {
  try {
    return await db.insert(message).values(messages);
  } catch (_error) {
    throw new ChatbotError("bad_request:database", "Failed to save messages");
  }
}

export async function updateMessage({
  id,
  parts,
}: {
  id: string;
  parts: DBMessage["parts"];
}) {
  try {
    return await db.update(message).set({ parts }).where(eq(message.id, id));
  } catch (_error) {
    throw new ChatbotError("bad_request:database", "Failed to update message");
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

export async function getMessageById({ id }: { id: string }) {
  try {
    return await db.select().from(message).where(eq(message.id, id));
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get message by id"
    );
  }
}

export async function deleteMessagesByChatIdAfterTimestamp({
  chatId,
  timestamp,
}: {
  chatId: string;
  timestamp: Date;
}) {
  try {
    const messagesToDelete = await db
      .select({ id: message.id })
      .from(message)
      .where(
        and(eq(message.chatId, chatId), gte(message.createdAt, timestamp))
      );

    const messageIds = messagesToDelete.map(
      (currentMessage) => currentMessage.id
    );

    if (messageIds.length > 0) {
      return await db
        .delete(message)
        .where(
          and(eq(message.chatId, chatId), inArray(message.id, messageIds))
        );
    }
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to delete messages by chat id after timestamp"
    );
  }
}

export async function updateChatVisibilityById({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: "private" | "public";
}) {
  try {
    return await db.update(chat).set({ visibility }).where(eq(chat.id, chatId));
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to update chat visibility by id"
    );
  }
}

export async function updateChatTitleById({
  chatId,
  title,
}: {
  chatId: string;
  title: string;
}) {
  try {
    return await db.update(chat).set({ title }).where(eq(chat.id, chatId));
  } catch (_error) {
    return;
  }
}

export async function getMessageCountByUserId({
  id,
  differenceInHours,
}: {
  id: string;
  differenceInHours: number;
}) {
  try {
    const cutoffTime = new Date(
      Date.now() - differenceInHours * 60 * 60 * 1000
    );

    const [stats] = await db
      .select({ count: count(message.id) })
      .from(message)
      .innerJoin(chat, eq(message.chatId, chat.id))
      .where(
        and(
          eq(chat.userId, id),
          gte(message.createdAt, cutoffTime),
          eq(message.role, "user")
        )
      )
      .execute();

    return stats?.count ?? 0;
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get message count by user id"
    );
  }
}

// ── Agent Queries ──────────────────────────────────────────────

export async function createAgentSession({
  chatId,
  userId,
  instructions,
}: {
  chatId: string;
  userId: string;
  instructions?: string | null;
}) {
  try {
    const [session] = await db
      .insert(agentSession)
      .values({ chatId, userId, instructions: instructions ?? null })
      .returning();
    return session;
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to create agent session",
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
      "Failed to get agent session",
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
}) {
  try {
    return await db
      .update(agentSession)
      .set(patch)
      .where(eq(agentSession.id, id));
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to update agent session",
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

// ── Partner agents & participants ──────────────────────────────

export async function getPartnerAgentByKeyHash(
  keyHash: string,
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
      "Failed to look up partner agent",
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
      "Failed to create partner agent",
    );
  }
}

export async function upsertParticipant({
  partnerAgentId,
  externalId,
  metadata,
}: {
  partnerAgentId: string;
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
            eq(participant.partnerAgentId, partnerAgentId),
            eq(participant.externalId, externalId),
          ),
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
      "Failed to upsert participant",
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
  partnerModel,
}: {
  chatId: string;
  partnerAgentId: string;
  participantId: string;
  userId: string;
  title: string;
  instructions?: string | null;
  promptId: string;
  promptVersion: string;
  condition?: string | null;
  partnerModel?: string | null;
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
      "Failed to create agent chat and session",
    );
  }
}

// ── Invitations ─────────────────────────────────────────────────

export async function createInvitation({
  jti,
  condition,
  expiresAt,
  batchLabel,
}: {
  jti: string;
  condition: string;
  expiresAt: Date;
  batchLabel?: string | null;
}): Promise<Invitation> {
  try {
    const [row] = await db
      .insert(invitation)
      .values({
        jti,
        condition,
        expiresAt,
        batchLabel: batchLabel ?? null,
      })
      .returning();
    return row;
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to create invitation",
    );
  }
}

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
    throw new ChatbotError(
      "bad_request:database",
      "Failed to load invitation",
    );
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
        and(eq(invitation.jti, jti), sql`${invitation.redeemedAt} IS NULL`),
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
      "Failed to redeem invitation",
    );
  }
}
