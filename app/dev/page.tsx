import { DEV_PROMPTS } from "@/lib/dev/prompts";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function DevDashboardPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16">
      <h1 className="font-semibold text-3xl mb-8">Developer Dashboard</h1>
      <p className="text-muted-foreground mb-8">
        Select a prompt condition to launch a test chatbot session. Links without a configured Prompt ID are disabled.
      </p>

      <div className="flex flex-col gap-4">
        {DEV_PROMPTS.map((prompt, i) => (
          <div
            key={i}
            className="flex items-center justify-between p-4 border rounded-lg bg-card"
          >
            <div>
              <div className="font-medium">{prompt.label}</div>
              {prompt.promptId ? (
                <div className="text-xs text-muted-foreground font-mono mt-1">
                  ID: {prompt.promptId}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground mt-1 italic">
                  Prompt ID not yet provided
                </div>
              )}
            </div>
            {prompt.promptId ? (
              <Button asChild>
                <Link href={`/dev/chat?id=${i}`}>Start Test Chat</Link>
              </Button>
            ) : (
              <Button disabled variant="outline">
                Start Test Chat
              </Button>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}
