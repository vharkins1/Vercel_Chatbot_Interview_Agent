import { requireAgentAuth } from "@/lib/agent-auth";
import {
  createSurveySubmission,
  getChatById,
  getSurveySubmission,
} from "@/lib/db/queries";
import { parsePages } from "@/lib/qualtrics/adapter";
import { getSurveyDefinition } from "@/lib/qualtrics/client";
import { toAgentSessionDTO } from "@/lib/study/agent-session-dto";
import { completeInterviewSession } from "@/lib/study/session-service";

export const maxDuration = 60;

type FirstSurveyPage = {
  page: number;
  totalPages: number;
  questions: unknown;
};

// Best-effort hand-off into the post-interview survey: load Qualtrics pages,
// initialize the SurveySubmission row, and return page 1 so the caller's next
// natural step is `POST /sessions/:chatId/survey`. Returns null when Qualtrics
// is unconfigured or the survey has already been submitted.
async function initSurveyHandoff(
  chatId: string
): Promise<FirstSurveyPage | null> {
  const surveyId = process.env.QUALTRICS_SURVEY_ID_STUDY1;
  if (!surveyId) {
    return null;
  }
  const def = await getSurveyDefinition(surveyId);
  if (!def.ok) {
    return null;
  }
  const pages = parsePages(def.value);
  if (pages.length === 0) {
    return null;
  }

  let submission = await getSurveySubmission({ chatId });
  if (!submission) {
    submission = await createSurveySubmission({
      chatId,
      surveyId,
      totalPages: pages.length,
    });
  }
  if (
    submission.status === "submitted" ||
    submission.currentPage >= pages.length
  ) {
    return null;
  }

  const page = pages[submission.currentPage];
  return {
    page: submission.currentPage + 1,
    totalPages: pages.length,
    questions: page.questions,
  };
}

export async function POST(
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

  const result = await completeInterviewSession({ chatId });
  if (!result?.agentSession) {
    return Response.json({ error: "no_agent_session" }, { status: 404 });
  }

  const survey = await initSurveyHandoff(chatId);

  return Response.json({
    chatId,
    completionCode: result.agentSession.completionCode,
    agentSession: toAgentSessionDTO(result.agentSession),
    survey,
  });
}
