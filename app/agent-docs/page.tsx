import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Metadata } from "next";
import { Streamdown } from "streamdown";

export const metadata: Metadata = {
  title: "Agent API — Interview Chatbot",
  description:
    "How autonomous agents authenticate and exchange turns with the interview chatbot.",
};

async function loadDocs(): Promise<string> {
  "use cache";
  const file = path.join(process.cwd(), "content", "agent-docs.md");
  return await readFile(file, "utf8");
}

export default async function AgentDocsPage() {
  const markdown = await loadDocs();

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <article className="prose prose-neutral dark:prose-invert max-w-none">
        <Streamdown>{markdown}</Streamdown>
      </article>
    </main>
  );
}
