
const token = "eyJhbGciOiJIUzI1NiJ9.eyJjb25kaXRpb24iOiJBIiwianRpIjoiYlFzNld3Rms0QTFOUW1faVl2cnNzUSIsImlhdCI6MTc4NTUyMDUzMCwiZXhwIjoxNzg4MTEyNTMwfQ.cldUmgAHSZxPjmL2kdvx9YZfFG2-dca3UfKTVKliilI";
const BASE_URL = "https://chatinterviewer.vercel.app";

async function main() {
  const res1 = await fetch(`${BASE_URL}/api/participant/v1/sessions`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ invitationToken: token })
  });
  const data1 = await res1.json();
  console.log("data1:", data1);
  const cookie = res1.headers.get("set-cookie").split(";")[0];

  const res2 = await fetch(`${BASE_URL}/api/participant/v1/sessions/${data1.chatId}/turns`, {
    method: "POST", headers: { "Content-Type": "application/json", "Cookie": cookie }, body: JSON.stringify({ message: "Hello! Let's start." })
  });
  const data2 = await res2.json();
  console.log("data2:", data2);
}
main().catch(console.error);
