const BASE =
  process.env.AGENT_API_BASE ??
  "https://vercel-chatbot-interview-agent-git-main-vharkins1s-projects.vercel.app";
const KEY = process.env.AGENT_API_KEY;
if (!KEY) {
  throw new Error("AGENT_API_KEY env var required");
}
// Tokens are now optional: if INVITATION_TOKEN is unset, the server will
// randomize the condition itself.
const INVITATION_TOKEN = process.env.INVITATION_TOKEN;

const PARTICIPANT_REPLIES = [
  "Hi — yes, I'm ready to start.",
  "Recently I've been feeling stretched thin between work and family commitments. Mostly tired, sometimes grateful when I get a quiet evening.",
  "The thing I've been most proud of lately is finishing a side project I'd been putting off for months. It wasn't huge but I'd avoided it for a long time.",
  "When I'm stressed I usually go for a walk or call my sister — talking it through helps more than trying to power through alone.",
  "A relationship that means a lot to me is with an old friend from college; we don't talk often but when we do it picks up like no time has passed.",
  "Something I find hard to talk about is feeling stuck in my career — I worry that admitting it makes it more real.",
  "If I could change one thing about how I handle conflict, I'd be slower to react. I tend to get defensive before I've actually heard the other person.",
  "A recent moment of joy was a weekend trip with friends where we didn't plan anything and it ended up being one of the best weekends I've had in a while.",
  "I think I'm growing in being more honest about what I actually want, instead of optimizing for what I think other people expect of me.",
  "Yes, that's a fair summary. Thanks for asking these — it was a useful prompt to think about.",
  "I don't think I have anything to add. Thanks.",
];

const END_PHRASES = [
  "thanks for sharing",
  "thanks for participating",
  "this concludes",
  "that concludes",
  "we're done",
  "we are done",
  "that's all the questions",
  "thats all the questions",
  "no more questions",
  "end of the interview",
  "interview is complete",
  "interview is over",
  "wrap up",
  "wrapping up",
];

function looksLikeEnd(text: string): boolean {
  const lower = text.toLowerCase();
  return END_PHRASES.some((p) => lower.includes(p));
}

async function discover() {
  const r = await fetch(`${BASE}/llms.txt`);
  console.log(`GET /llms.txt → ${r.status} ${r.headers.get("content-type")}`);
  console.log(`first 80 chars: ${(await r.text()).slice(0, 80)}…\n`);
}

async function createSession() {
  const r = await fetch(`${BASE}/api/agent/v1/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      participantExternalId: `e2e-test-${Date.now()}`,
      participantMetadata: { note: "end-to-end smoke" },
      title: "E2E agent smoke test",
      ...(INVITATION_TOKEN ? { invitationToken: INVITATION_TOKEN } : {}),
      partnerModel: process.env.PARTNER_MODEL ?? "e2e-test-runner-script",
    }),
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`create session ${r.status}: ${body}`);
  }
  const json = (await r.json()) as { chatId: string };
  console.log(`POST /sessions → ${r.status}, chatId=${json.chatId}\n`);
  return json.chatId;
}

async function turn(chatId: string, text: string): Promise<string> {
  const r = await fetch(`${BASE}/api/agent/v1/sessions/${chatId}/turns`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`turn ${r.status}: ${body}`);
  }
  const json = (await r.json()) as {
    assistantMessage: { parts: { type: string; text: string }[] };
  };
  return json.assistantMessage.parts.map((p) => p.text).join("\n");
}

async function complete(chatId: string) {
  const r = await fetch(`${BASE}/api/agent/v1/sessions/${chatId}/complete`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}` },
  });
  console.log(`POST /complete → ${r.status}`);
}

async function main() {
  await discover();
  const chatId = await createSession();

  const MAX_TURNS = 30;
  let endedNaturally = false;
  for (let i = 0; i < MAX_TURNS; i++) {
    const reply =
      PARTICIPANT_REPLIES[Math.min(i, PARTICIPANT_REPLIES.length - 1)];
    console.log(`── turn ${i + 1} ──`);
    console.log(`PARTICIPANT: ${reply}`);
    const assistant = await turn(chatId, reply);
    console.log(`ASSISTANT:   ${assistant}\n`);
    if (looksLikeEnd(assistant)) {
      endedNaturally = true;
      console.log("(end-of-interview phrase detected; stopping.)\n");
      break;
    }
  }

  if (!endedNaturally) {
    console.log(`(stopped after ${MAX_TURNS} turns without end signal.)\n`);
  }

  await complete(chatId);
  console.log(`\nchatId=${chatId}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
