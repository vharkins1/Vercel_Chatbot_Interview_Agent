import { readFile } from "node:fs/promises";
import path from "node:path";

async function loadDocs(): Promise<string> {
  "use cache";
  const file = path.join(process.cwd(), "content", "agent-docs.md");
  return await readFile(file, "utf8");
}

export async function GET() {
  const body = await loadDocs();

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=3600",
    },
  });
}
