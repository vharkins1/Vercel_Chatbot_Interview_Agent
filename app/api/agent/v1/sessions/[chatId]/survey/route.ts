import { z } from "zod";
import { requireAgentAuth } from "@/lib/agent-auth";
import {
  createSurveySubmission,
  getAgentSessionByChatId,
  getChatById,
  getSurveyAnswers,
  getSurveySubmission,
  updateSurveySubmission,
  upsertSurveyAnswers,
} from "@/lib/db/queries";
import {
  buildQualtricsValues,
  parsePages,
  validatePageAnswers,
} from "@/lib/qualtrics/adapter";
import { getSurveyDefinition, submitResponse } from "@/lib/qualtrics/client";

export const maxDuration = 60;

function surveyId(): string | null {
  return process.env.QUALTRICS_SURVEY_ID_STUDY1 ?? null;
}

// Fetches + parses the configured Study 1 survey. Returns null tagged with a
// machine-readable reason so the caller can map cleanly to an HTTP status.
async function loadPages(): Promise<
  | { ok: true; surveyId: string; pages: ReturnType<typeof parsePages> }
  | { ok: false; status: number; error: string }
> {
  const id = surveyId();
  if (!id) {
    return { ok: false, status: 503, error: "survey_not_configured" };
  }
  const def = await getSurveyDefinition(id);
  if (!def.ok) {
    if (def.reason === "not_configured") {
      return { ok: false, status: 503, error: "qualtrics_not_configured" };
    }
    return {
      ok: false,
      status: 502,
      error: `qualtrics_definition_failed:${def.status}`,
    };
  }
  return { ok: true, surveyId: id, pages: parsePages(def.value) };
}

// ── GET ─────────────────────────────────────────────────────────

export async function GET(
  request: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  const auth = await requireAgentAuth(request);
  if (!auth.ok) {
    return auth.response;
  }

  const { chatId } = await params;
  const chat = await getChatById({ id: chatId });
  if (!chat) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  if (chat.partnerAgentId !== auth.partnerAgentId) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const session = await getAgentSessionByChatId({ chatId });
  if (!session) {
    return Response.json({ error: "no_agent_session" }, { status: 404 });
  }
  if (!session.completedAt) {
    return Response.json({ error: "interview_not_completed" }, { status: 409 });
  }

  const loaded = await loadPages();
  if (!loaded.ok) {
    return Response.json({ error: loaded.error }, { status: loaded.status });
  }
  const { surveyId: sid, pages } = loaded;

  let submission = await getSurveySubmission({ chatId });
  if (!submission) {
    submission = await createSurveySubmission({
      chatId,
      surveyId: sid,
      totalPages: pages.length,
    });
  }

  const done =
    submission.status === "submitted" || submission.currentPage >= pages.length;

  if (done) {
    return Response.json({
      done: true,
      totalPages: pages.length,
      status: submission.status,
      qualtricsResponseId: submission.qualtricsResponseId ?? null,
    });
  }

  const page = pages[submission.currentPage];
  return Response.json({
    done: false,
    page: submission.currentPage + 1,
    totalPages: pages.length,
    questions: page.questions,
  });
}

// ── POST ────────────────────────────────────────────────────────

const postSchema = z.object({
  page: z.number().int().positive(),
  answers: z.record(z.string(), z.unknown()),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  const auth = await requireAgentAuth(request);
  if (!auth.ok) {
    return auth.response;
  }

  const { chatId } = await params;

  let parsed: z.infer<typeof postSchema>;
  try {
    parsed = postSchema.parse(await request.json());
  } catch (_) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const chat = await getChatById({ id: chatId });
  if (!chat) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  if (chat.partnerAgentId !== auth.partnerAgentId) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const session = await getAgentSessionByChatId({ chatId });
  if (!session) {
    return Response.json({ error: "no_agent_session" }, { status: 404 });
  }
  if (!session.completedAt) {
    return Response.json({ error: "interview_not_completed" }, { status: 409 });
  }
  if (!session.completionCode) {
    return Response.json({ error: "missing_completion_code" }, { status: 500 });
  }

  const loaded = await loadPages();
  if (!loaded.ok) {
    return Response.json({ error: loaded.error }, { status: loaded.status });
  }
  const { surveyId: sid, pages } = loaded;

  const submission =
    (await getSurveySubmission({ chatId })) ??
    (await createSurveySubmission({
      chatId,
      surveyId: sid,
      totalPages: pages.length,
    }));

  if (submission.status === "submitted") {
    return Response.json({
      done: true,
      page: pages.length,
      totalPages: pages.length,
      qualtricsResponseId: submission.qualtricsResponseId,
    });
  }

  // The agent must submit pages in order. Re-submitting the current page
  // (e.g. retry on network error) is allowed and overwrites; past pages are
  // rejected to prevent silent overwrites of validated answers.
  const expectedPageNumber = submission.currentPage + 1;
  if (parsed.page !== expectedPageNumber) {
    return Response.json(
      {
        error: "wrong_page",
        expected: expectedPageNumber,
        received: parsed.page,
      },
      { status: 409 }
    );
  }

  const page = pages[submission.currentPage];
  const validation = validatePageAnswers(page, parsed.answers);
  if (!validation.ok) {
    return Response.json(
      { error: "invalid_answers", detail: validation.error },
      { status: 400 }
    );
  }

  const answerRows = [...validation.values.entries()].map(([qid, value]) => ({
    qid,
    value,
  }));
  await upsertSurveyAnswers({ chatId, answers: answerRows });

  const nextPage = submission.currentPage + 1;
  const isFinalPage = nextPage >= pages.length;

  if (!isFinalPage) {
    await updateSurveySubmission({ chatId, currentPage: nextPage });
    return Response.json({
      done: false,
      page: nextPage + 1,
      totalPages: pages.length,
    });
  }

  // Final page: submit the whole response to Qualtrics. We've already
  // persisted answers, so a Qualtrics failure is recoverable — the row sits
  // with status=failed and a retry would re-submit.
  await updateSurveySubmission({ chatId, currentPage: nextPage });

  const allAnswers = await getSurveyAnswers({ chatId });
  // Only completion_code is declared as Embedded Data on the survey. condition,
  // pid, source, and partnerAgentId/userId all flow back through Supabase via
  // AgentSession.completionCode → join.
  const embedded: Record<string, string> = {
    completion_code: session.completionCode,
  };
  const values = buildQualtricsValues(
    allAnswers.map((a) => ({ qid: a.qid, value: a.value })),
    pages,
    embedded
  );

  const submitted = await submitResponse(sid, values);
  if (!submitted.ok) {
    const reason =
      submitted.reason === "not_configured"
        ? "qualtrics_not_configured"
        : `qualtrics_submit_failed:${submitted.status}`;
    await updateSurveySubmission({
      chatId,
      status: "failed",
      lastError: reason,
    });
    return Response.json({ error: reason }, { status: 502 });
  }

  await updateSurveySubmission({
    chatId,
    status: "submitted",
    qualtricsResponseId: submitted.value.responseId,
    submittedAt: new Date(),
    lastError: null,
  });

  return Response.json({
    done: true,
    page: pages.length,
    totalPages: pages.length,
    qualtricsResponseId: submitted.value.responseId,
  });
}
