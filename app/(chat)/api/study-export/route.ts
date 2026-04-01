import { NextResponse } from "next/server";
import { getAllStudySessions } from "@/lib/db/queries";

export async function GET(request: Request) {
  // Check authorization key
  const authHeader = request.headers.get("authorization");
  const expectedKey = process.env.STUDY_EXPORT_KEY;

  if (!expectedKey || authHeader !== `Bearer ${expectedKey}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const sessions = await getAllStudySessions();

    // For a real export, you'd likely also iterate over all sessions
    // to fetch and format their associated messages into the export payload.
    // Given potentially large DBs, doing it via a direct script or 
    // structured batch is safer, but this works for demo/start.
    
    return NextResponse.json({
      exports: sessions.map((s) => ({
        studySessionId: s.StudySession.id,
        chatId: s.StudySession.chatId,
        userId: s.StudySession.userId,
        condition: s.StudySession.condition,
        phase: s.StudySession.phase,
        surveyData: s.StudySession.surveyData,
        startedAt: s.StudySession.createdAt,
        completedAt: s.StudySession.completedAt,
        chatTitle: s.Chat?.title,
      })),
    });
  } catch (error) {
    console.error("Export error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
