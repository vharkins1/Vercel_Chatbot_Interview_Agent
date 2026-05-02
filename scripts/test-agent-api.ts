import "dotenv/config";

const BASE = process.env.AGENT_API_BASE ?? "http://localhost:3000";
const KEY = process.env.AGENT_API_KEY;
const EXPORT_KEY = process.env.STUDY_EXPORT_KEY;

if (!KEY) throw new Error("AGENT_API_KEY required");

const headers = {
  "content-type": "application/json",
  authorization: `Bearer ${KEY}`,
};

async function call(path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new Error(
      `${init.method ?? "GET"} ${path} → ${res.status}: ${JSON.stringify(body)}`,
    );
  }
  return body;
}

async function main() {
  console.log("→ POST /sessions");
  const start = (await call("/api/agent/v1/sessions", {
    method: "POST",
    body: JSON.stringify({ feedbackStyle: "neutral" }),
  })) as { chatId: string; questionsBlock: string };

  console.log(`  chatId=${start.chatId}`);
  console.log("  questionsBlock:");
  console.log(start.questionsBlock.split("\n").map((l) => `    ${l}`).join("\n"));

  const replies = [
    "Hi, ready to start.",
    "I think most people are basically well-meaning when you give them the chance.",
    "I get a lot of energy from cooking — particularly slow braises on the weekend.",
    "I'm a software engineer working on AI tooling.",
    "I'd describe myself as curious and a bit stubborn.",
    "I run about 25 miles a week to stay in shape.",
    "I budget tightly but try not to be miserly about experiences.",
  ];

  for (let i = 0; i < replies.length; i++) {
    console.log(`→ POST /sessions/${start.chatId}/turns (turn ${i + 1})`);
    const turn = (await call(
      `/api/agent/v1/sessions/${start.chatId}/turns`,
      {
        method: "POST",
        body: JSON.stringify({ text: replies[i] }),
      },
    )) as {
      assistantMessage: { parts: { type: string; text: string }[] };
    };
    const text = turn.assistantMessage.parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("");
    console.log(`  assistant: ${text.slice(0, 200)}${text.length > 200 ? "…" : ""}`);
    if (!text.trim()) throw new Error("empty assistant reply");
  }

  console.log(`→ POST /sessions/${start.chatId}/complete`);
  const completed = (await call(
    `/api/agent/v1/sessions/${start.chatId}/complete`,
    {
      method: "POST",
      body: JSON.stringify({ surveyData: { source: "smoke-test" } }),
    },
  )) as {
    studySession: { completedAt: string | null };
    messages: unknown[];
  };
  console.log(`  completedAt=${completed.studySession.completedAt}`);
  console.log(`  message count=${completed.messages.length}`);
  if (!completed.studySession.completedAt) {
    throw new Error("completedAt not set");
  }

  if (EXPORT_KEY) {
    console.log("→ GET /api/study-export");
    const exportRes = await fetch(`${BASE}/api/study-export`, {
      headers: { authorization: `Bearer ${EXPORT_KEY}` },
    });
    if (!exportRes.ok) throw new Error(`export status ${exportRes.status}`);
    const data = (await exportRes.json()) as {
      exports: { chatId: string; completedAt: string | null }[];
    };
    const found = data.exports.find((e) => e.chatId === start.chatId);
    if (!found) throw new Error("session missing from export");
    if (!found.completedAt) throw new Error("export shows no completedAt");
    console.log("  ✓ session present in export with completedAt");
  } else {
    console.log("(skip export check — STUDY_EXPORT_KEY not set)");
  }

  console.log("✓ smoke test passed");
}

main().catch((error) => {
  console.error("✗", error);
  process.exit(1);
});
