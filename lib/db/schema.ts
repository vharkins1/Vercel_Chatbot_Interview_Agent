import { type InferSelectModel, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  json,
  pgSchema,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const privateSchema = pgSchema("private");

export const runtimePrompt = privateSchema.table("RuntimePrompt", {
  key: text("key").primaryKey().notNull(),
  content: text("content").notNull(),
  version: integer("version").notNull().default(1),
  updatedAt: timestamp("updatedAt", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type RuntimePrompt = InferSelectModel<typeof runtimePrompt>;

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
    startIpHash: text("startIpHash"),
  },
  (table) => ({
    partnerAgentIdx: index("Chat_partnerAgentId_idx").on(table.partnerAgentId),
    participantIdx: index("Chat_participantId_idx").on(table.participantId),
    startIpHashIdx: index("Chat_startIpHash_idx").on(table.startIpHash),
  })
);

export type Chat = InferSelectModel<typeof chat>;

export const chatLog = pgTable(
  "ChatLogs",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    chatId: uuid("chatId")
      .notNull()
      .references(() => chat.id),
    role: varchar("role").notNull(),
    parts: json("parts").notNull(),
    attachments: json("attachments").notNull(),
    createdAt: timestamp("createdAt").notNull(),
    partnerModel: text("partnerModel"),
    ipHash: text("ipHash"),
  },
  (table) => ({
    ipHashIdx: index("ChatLogs_ipHash_idx").on(table.ipHash),
    createdAtDescIdx: index("ChatLogs_createdAt_desc_idx").on(
      table.createdAt.desc()
    ),
  })
);

export type DBChatLog = InferSelectModel<typeof chatLog>;

// ── Agent ───────────────────────────────────────────────────────

export const agentSession = pgTable(
  "AgentSession",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    // Monotonic, human-friendly participant counter. Assigned DB-side via a
    // Postgres sequence (default nextval) on insert — see migration 0019. Null
    // for sessions created before the sequence was introduced; 1,2,3,… from the
    // first session after. Surfaced to partners on the session DTO and pushed to
    // Qualtrics as the `participant_seq` embedded-data field.
    seq: integer("seq"),
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
    conditionLabel: text("conditionLabel"),
    interviewerModel: text("interviewerModel"),
    partnerModel: text("partnerModel"),
    totalTokens: integer("totalTokens").notNull().default(0),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    completedAt: timestamp("completedAt"),
    partnerAgentId: uuid("partnerAgentId").references(() => partnerAgent.id),
    participantId: uuid("participantId").references(() => participant.id),
    completionCode: text("completionCode"),
    // Qualtrics StudyID of the PRE-interview survey. This is the join key
    // across pre-survey ↔ transcript ↔ post-survey. Null for agent sessions
    // and for humans who reached /chat without one.
    studyId: text("StudyID"),
    // SONA participant id carried from recruitment through both Qualtrics
    // surveys. Kept separate from StudyID because it identifies the person for
    // SONA credit rather than a specific pre-survey response.
    sonaId: text("sonaId"),
    // Device/browser the participant took the interview on, derived server-side
    // from the User-Agent at session creation (lib/study/device.ts). Kept as
    // dedicated columns rather than JSONB so device can be a grouping variable
    // in SQL. Objective counterpart to the self-reported device item on the
    // pre-survey. Null for agent sessions.
    deviceType: text("deviceType"),
    browser: text("browser"),
    os: text("os"),
    userAgent: text("userAgent"),
  },
  (table) => ({
    partnerAgentIdx: index("AgentSession_partnerAgentId_idx").on(
      table.partnerAgentId
    ),
    participantIdx: index("AgentSession_participantId_idx").on(
      table.participantId
    ),
    completionCodeIdx: uniqueIndex("AgentSession_completionCode_idx").on(
      table.completionCode
    ),
    studyIdIdx: index("AgentSession_StudyID_idx").on(table.studyId),
    createdAtDescIdx: index("AgentSession_createdAt_desc_idx").on(
      table.createdAt.desc()
    ),
  })
);

export type AgentSession = InferSelectModel<typeof agentSession>;

// ── Qualtrics survey handoff (Study 1) ──────────────────────────

export const surveySubmission = pgTable(
  "SurveySubmission",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    chatId: uuid("chatId")
      .notNull()
      .unique()
      .references(() => chat.id),
    surveyId: text("surveyId").notNull(),
    currentPage: integer("currentPage").notNull().default(0),
    totalPages: integer("totalPages").notNull(),
    status: text("status").notNull().default("in_progress"),
    qualtricsResponseId: text("qualtricsResponseId"),
    lastError: text("lastError"),
    submittedAt: timestamp("submittedAt"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  },
  (table) => ({
    qualtricsResponseIdx: index("SurveySubmission_qualtricsResponseId_idx").on(
      table.qualtricsResponseId
    ),
    statusIdx: index("SurveySubmission_status_idx").on(table.status),
  })
);

export type SurveySubmission = InferSelectModel<typeof surveySubmission>;

export const surveyAnswer = pgTable(
  "SurveyAnswer",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    chatId: uuid("chatId")
      .notNull()
      .references(() => chat.id),
    qid: text("qid").notNull(),
    value: text("value").notNull(),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (table) => ({
    chatQidUnique: uniqueIndex("SurveyAnswer_chatId_qid_idx").on(
      table.chatId,
      table.qid
    ),
    qidIdx: index("SurveyAnswer_qid_idx").on(table.qid),
  })
);

export type SurveyAnswer = InferSelectModel<typeof surveyAnswer>;

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
    partnerAgentId: uuid("partnerAgentId").references(() => partnerAgent.id, {
      onDelete: "cascade",
    }),
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
      table.externalId
    ),
  })
);

export type Participant = InferSelectModel<typeof participant>;

// ── Invitations ─────────────────────────────────────────────────

export const invitation = pgTable(
  "Invitation",
  {
    jti: text("jti").primaryKey().notNull(),
    // Null means the invitation pins no arm and the server assigns one at
    // session creation (the Qualtrics entry link). Non-null keeps the original
    // behaviour: the arm was fixed when the token was minted.
    condition: text("condition"),
    conditionLabel: text("conditionLabel"),
    expiresAt: timestamp("expiresAt").notNull(),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    redeemedAt: timestamp("redeemedAt"),
    redeemedByChatId: uuid("redeemedByChatId"),
    redeemedByExternalId: text("redeemedByExternalId"),
    batchLabel: text("batchLabel"),
    // Per-row reusability. One-shot invitations (the original recruitment
    // model) stay false and are burned by redeemInvitation. The Qualtrics
    // entry link is true: one URL serves every participant, so identity comes
    // from the Qualtrics StudyID instead of from token uniqueness.
    multiUse: boolean("multiUse").notNull().default(false),
    useCount: integer("useCount").notNull().default(0),
  },
  (table) => ({
    batchIdx: index("Invitation_batchLabel_idx").on(table.batchLabel),
    redeemedChatIdx: index("Invitation_redeemedByChatId_idx").on(
      table.redeemedByChatId
    ),
  })
);

export type Invitation = InferSelectModel<typeof invitation>;

// ── Interview question bank + per-chat selections ──────────────

/**
 * One physical table serves two roles:
 * - bank rows: `chatId` and ordering fields are null;
 * - selected rows: `chatId`, `sourceQuestionId`, and ordering fields are set.
 *
 * Selected rows snapshot topic/text so historical interviews remain stable if
 * a bank question is later edited or deactivated.
 */
export const question = pgTable(
  "Question",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    chatId: uuid("chatId").references(() => chat.id, { onDelete: "cascade" }),
    sourceQuestionId: uuid("sourceQuestionId").references(
      (): AnyPgColumn => question.id
    ),
    topicId: text("topicId").notNull(),
    topicName: text("topicName").notNull(),
    topicDisplayOrder: integer("topicDisplayOrder"),
    text: text("text").notNull(),
    isActive: boolean("isActive").notNull().default(true),
    topicOrder: integer("topicOrder"),
    questionOrder: integer("questionOrder"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (table) => ({
    chatIdx: index("Question_chatId_idx").on(table.chatId),
    sourceIdx: index("Question_sourceQuestionId_idx").on(
      table.sourceQuestionId
    ),
    bankTopicIdx: index("Question_bank_topic_idx")
      .on(table.topicDisplayOrder, table.topicId)
      .where(sql`${table.chatId} IS NULL`),
    bankTopicTextUq: uniqueIndex("Question_bank_topic_text_uq")
      .on(table.topicId, table.text)
      .where(sql`${table.chatId} IS NULL`),
    chatSourceUq: uniqueIndex("Question_chat_source_uq")
      .on(table.chatId, table.sourceQuestionId)
      .where(sql`${table.chatId} IS NOT NULL`),
    rowKindCheck: check(
      "Question_row_kind_chk",
      sql`(
        (
          ${table.chatId} IS NULL
          AND ${table.sourceQuestionId} IS NULL
          AND ${table.topicOrder} IS NULL
          AND ${table.questionOrder} IS NULL
        )
        OR
        (
          ${table.chatId} IS NOT NULL
          AND ${table.sourceQuestionId} IS NOT NULL
          AND ${table.topicOrder} IS NOT NULL
          AND ${table.questionOrder} IS NOT NULL
        )
      )`
    ),
  })
);

export type Question = InferSelectModel<typeof question>;
