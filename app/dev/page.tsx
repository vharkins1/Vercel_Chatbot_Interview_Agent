import { DEV_PROMPTS } from "@/lib/dev/prompts";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
                <div className="text-xs text-muted-foreground font-mono mt-1 flex gap-4">
                  <span>ID: {prompt.promptId}</span>
                  {prompt.version && <span>Version: {prompt.version}</span>}
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
        
        {/* Custom Prompt Testing Section */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 border-2 border-dashed rounded-lg bg-muted/20 mt-4 gap-4">
          <div>
            <div className="font-medium text-lg">Test Custom Prompt ID</div>
            <div className="text-sm text-muted-foreground mt-1">
              Paste your own OpenAI Prompt ID to test new versions instantly.
            </div>
          </div>
          
          <form action="/dev/chat" method="GET" className="flex items-center gap-2">
            <Input
              type="text"
              name="customId"
              placeholder="Prompt ID (pmpt_...)"
              className="w-[180px] bg-background"
              required
              pattern="^pmpt_[a-zA-Z0-9]+$"
              title="Must be a valid OpenAI Prompt ID starting with pmpt_"
            />
            <Input
              type="number"
              name="customVersion"
              placeholder="Ver (e.g. 1)"
              className="w-[110px] bg-background"
              min="1"
              defaultValue="1"
              title="Prompt Version Number"
            />
            <Button type="submit">Start Test</Button>
          </form>
        </div>
      </div>
    </main>
  );
}
