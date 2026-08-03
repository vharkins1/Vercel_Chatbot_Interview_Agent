import { config } from "dotenv";
config({ path: ".env.local" });

const TOKENS = {
  A: "eyJhbGciOiJIUzI1NiJ9.eyJjb25kaXRpb24iOiJBIiwianRpIjoiTUpYQVk0SU1qbnVabjVLODRtNENQUSIsImlhdCI6MTc4NTUyMDU4MiwiZXhwIjoxNzg4MTEyNTgyfQ.h2VRs4ToQngyAM0XE5pSoZpKyKi0lKdVVbr8T_U2BhY",
  B: "eyJhbGciOiJIUzI1NiJ9.eyJjb25kaXRpb24iOiJCIiwianRpIjoiWDFjY0F5ekt4ZG91YmpUV3RXTGhFdyIsImlhdCI6MTc4NTUyMDU4MywiZXhwIjoxNzg4MTEyNTgzfQ.WsWPECQve2u-RqhZqRKuKfL6pFm_fKGFxE48UACnTmQ",
  C: "eyJhbGciOiJIUzI1NiJ9.eyJjb25kaXRpb24iOiJDIiwianRpIjoicE5RajFlY1FLem80Y2l3WnVjdkJudyIsImlhdCI6MTc4NTUyMDU4NSwiZXhwIjoxNzg4MTEyNTg1fQ.dApt9xS_npvgWy_w0_vEPhW2l_dXgBUJvaMVrdau7JM",
};

const BASE_URL = "https://chatinterviewer.vercel.app";

async function runTest(condition, token) {
  console.log(`\n--- Starting Test for Condition ${condition} ---`);
  
  const res1 = await fetch(`${BASE_URL}/api/participant/v1/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ invitationToken: token }),
  });
  
  if (!res1.ok) {
    console.error(`Failed to start session for ${condition}:`, await res1.text());
    return;
  }
  
  const data1 = await res1.json();
  const chatId = data1.chatId;
  const cookie = res1.headers.get("set-cookie").split(";")[0];
  console.log(`Session started. ChatId: ${chatId}`);

  let ended = false;
  let turnCount = 0;

  let res2 = await fetch(`${BASE_URL}/api/participant/v1/sessions/${chatId}/turns`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Cookie": cookie },
    body: JSON.stringify({ text: "Hello! Let's start." }),
  });
  let data2 = await res2.json();
  console.log(`[Turn 1] AI: ${data2.assistantMessage.text.substring(0, 50)}...`);

  // Loop up to 20 times
  while (!ended && turnCount < 20) {
    turnCount++;
    const userMsg = "That makes sense. Can we move on to the next question please?";
    const res = await fetch(`${BASE_URL}/api/participant/v1/sessions/${chatId}/turns`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cookie": cookie },
      body: JSON.stringify({ text: userMsg }),
    });
    
    const data = await res.json();
    if (!res.ok) {
      console.error(`Error on turn ${turnCount + 1}:`, data);
      break;
    }
    
    console.log(`[Turn ${turnCount + 1}] AI: ${data.assistantMessage.text.substring(0, 80)}...`);
    
    if (data.ended || data.assistantMessage.text.includes("qualtrics.com")) {
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
