import { config } from "dotenv";
config({ path: ".env.local" });

const TOKENS = {
  B: "eyJhbGciOiJIUzI1NiJ9.eyJjb25kaXRpb24iOiJCIiwianRpIjoiUmNCTmxtUHdiblZSanFKbkFUakNmdyIsImlhdCI6MTc4NTUyMDY5MCwiZXhwIjoxNzg4MTEyNjkwfQ.gAXgXPBntlsxmZh_kekXeQTXxyXD09kCCzz_ThyH7vs",
  C: "eyJhbGciOiJIUzI1NiJ9.eyJjb25kaXRpb24iOiJDIiwianRpIjoiRXpvYVBBSVVpaG9lM0dPcFhHNlVPdyIsImlhdCI6MTc4NTUyMDY5MiwiZXhwIjoxNzg4MTEyNjkyfQ.7lpb-_HtDtp6fnAV4LAlpfG-qKxtVR--Z0ojSLn1a0M",
};

const BASE_URL = "https://chatinterviewer.vercel.app";

async function runTest(condition, token) {
  console.log(`\n--- Starting Test for Condition ${condition} ---`);
  const res1 = await fetch(`${BASE_URL}/api/participant/v1/sessions`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ invitationToken: token }),
  });
  const data1 = await res1.json();
  const chatId = data1.chatId;
  const cookie = res1.headers.get("set-cookie").split(";")[0];

  let ended = false;
  let turnCount = 0;

  let res2 = await fetch(`${BASE_URL}/api/participant/v1/sessions/${chatId}/turns`, {
    method: "POST", headers: { "Content-Type": "application/json", "Cookie": cookie }, body: JSON.stringify({ text: "Hello! Let's start." }),
  });
  let data2 = await res2.json();
  console.log(`[Turn 1] AI: ${data2.assistantMessage.text.substring(0, 50)}...`);

  while (!ended && turnCount < 20) {
    turnCount++;
    const userMsg = "Yes, I agree. Please continue to the next question.";
    const res = await fetch(`${BASE_URL}/api/participant/v1/sessions/${chatId}/turns`, {
      method: "POST", headers: { "Content-Type": "application/json", "Cookie": cookie }, body: JSON.stringify({ text: userMsg }),
    });
    const data = await res.json();
    console.log(`[Turn ${turnCount + 1}] AI: ${data.assistantMessage?.text?.substring(0, 60)}...`);
    
    if (data.ended || (data.assistantMessage && data.assistantMessage.text.includes("qualtrics.com"))) {
      console.log(`\n✅ QUALTRICS LINK DETECTED in condition ${condition} on turn ${turnCount + 1}!`);
      console.log(`Full final message:\n${data.assistantMessage.text}\n`);
      ended = true;
    }
  }
}
async function main() {
  for (const [cond, token] of Object.entries(TOKENS)) {
    await runTest(cond, token);
  }
}
main().catch(console.error);
