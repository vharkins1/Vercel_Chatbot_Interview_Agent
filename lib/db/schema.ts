import type { InferSelectModel } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  json,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const user = pgTable("User", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  email: varchar("email", { length: 64 }).notNull(),
  password: varchar("password", { length: 64 }),
  name: text("name"),
  emailVerified: boolean("emailVerified").notNull().default(false),
  image: text("image"),
  isAnonymous: boolean("isAnonymous").notNull().default(false),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
});

export type User = InferSelectModel<typeof user>;

export const chat = pgTable(
  "Chat",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    createdAt: timestamp("createdAt").notNull(),
    title: text("title").notNull(),
    userId: uuid("userId")
      .notNull()
      .references(() => user.id),
    visibility: varchar("visibility", { enum: ["public", "private"] })
      .notNull()
      .default("private"),
    partnerAgentId: uuid("partnerAgentId").references(() => partnerAgent.id),
    participantId: uuid("participantId").references(() => participant.id),
  },
  (table) => ({
    partnerAgentIdx: index("Chat_partnerAgentId_idx").on(table.partnerAgentId),
    participantIdx: index("Chat_participantId_idx").on(table.participantId),
  }),
);

export type Chat = InferSelectModel<typeof chat>;

export const message = pgTable("Message_v2", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  chatId: uuid("chatId")
    .notNull()
    .references(() => chat.id),
  role: varchar("role").notNull(),
  parts: json("parts").notNull(),
  attachments: json("attachments").notNull(),
  createdAt: timestamp("createdAt").notNull(),
});

export type DBMessage = InferSelectModel<typeof message>;

// ── Agent ───────────────────────────────────────────────────────

export const agentSession = pgTable(
  "AgentSession",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    chatId: uuid("chatId")
      .notNull()
      .unique()
      .references(() => chat.id),
    userId: uuid("userId")
      .notNull()
      .references(() => user.id),
    responseId: text("responseId"),
    instructions: text("instructions"),
    promptId: text("promptId"),
    promptVersion: text("promptVersion"),
    condition: text("condition"),
    totalTokens: integer("totalTokens").notNull().default(0),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    completedAt: timestamp("completedAt"),
    partnerAgentId: uuid("partnerAgentId").references(() => partnerAgent.id),
    participantId: uuid("participantId").references(() => participant.id),
  },
  (table) => ({
    partnerAgentIdx: index("AgentSession_partnerAgentId_idx").on(
      table.partnerAgentId,
    ),
    participantIdx: index("AgentSession_participantId_idx").on(
      table.participantId,
    ),
  }),
);

export type AgentSession = InferSelectModel<typeof agentSession>;

// ── Partner agents & study participants ─────────────────────────

export const partnerAgent = pgTable("PartnerAgent", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  name: text("name").notNull().unique(),
  keyHash: text("keyHash").notNull().unique(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  revokedAt: timestamp("revokedAt"),
  lastUsedAt: timestamp("lastUsedAt"),
});

export type PartnerAgent = InferSelectModel<typeof partnerAgent>;

export const participant = pgTable(
  "Participant",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    partnerAgentId: uuid("partnerAgentId")
      .notNull()
      .references(() => partnerAgent.id, { onDelete: "cascade" }),
    externalId: text("externalId").notNull(),
    userId: uuid("userId")
      .notNull()
      .references(() => user.id),
    metadata: json("metadata"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (table) => ({
    partnerExternalUq: uniqueIndex("Participant_partner_external_uq").on(
      table.partnerAgentId,
      table.externalId,
    ),
  }),
);

export type Participant = InferSelectModel<typeof participant>;

// ── Invitations ─────────────────────────────────────────────────

export const invitation = pgTable(
  "Invitation",
  {
    jti: text("jti").primaryKey().notNull(),
    condition: text("condition").notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    redeemedAt: timestamp("redeemedAt"),
    redeemedByChatId: uuid("redeemedByChatId"),
    redeemedByExternalId: text("redeemedByExternalId"),
    batchLabel: text("batchLabel"),
  },
  (table) => ({
    batchIdx: index("Invitation_batchLabel_idx").on(table.batchLabel),
    redeemedChatIdx: index("Invitation_redeemedByChatId_idx").on(
      table.redeemedByChatId,
    ),
  }),
);

export type Invitation = InferSelectModel<typeof invitation>;

// ── Interview question bank ─────────────────────────────────────

export const topic = pgTable("Topic", {
  id: text("id").primaryKey().notNull(),
  name: text("name").notNull(),
  displayOrder: integer("displayOrder"),
});

export type Topic = InferSelectModel<typeof topic>;

export const question = pgTable(
  "Question",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    topicId: text("topicId")
      .notNull()
      .references(() => topic.id),
    text: text("text").notNull(),
    isActive: boolean("isActive").notNull().default(true),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (table) => ({
    topicIdx: index("Question_topicId_idx").on(table.topicId),
    topicTextUq: uniqueIndex("Question_topicId_text_uq").on(
      table.topicId,
      table.text,
    ),
  }),
);

export type Question = InferSelectModel<typeof question>;

export const chatQuestion = pgTable(
  "ChatQuestion",
  {
    chatId: uuid("chatId")
      .notNull()
      .references(() => chat.id, { onDelete: "cascade" }),
    questionId: uuid("questionId")
      .notNull()
      .references(() => question.id),
    topicId: text("topicId")
      .notNull()
      .references(() => topic.id),
    topicOrder: integer("topicOrder").notNull(),
    questionOrder: integer("questionOrder").notNull(),
    questionTextSnapshot: text("questionTextSnapshot").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.chatId, table.questionId] }),
    chatIdx: index("ChatQuestion_chatId_idx").on(table.chatId),
    topicIdx: index("ChatQuestion_topicId_idx").on(table.topicId),
  }),
);

export type ChatQuestion = InferSelectModel<typeof chatQuestion>;
