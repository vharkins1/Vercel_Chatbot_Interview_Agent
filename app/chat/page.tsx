import type { Metadata } from "next";
import { Suspense } from "react";
import { ChatClient } from "./chat-client";

export const metadata: Metadata = {
  title: "Interview: DEMO Lab",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function ChatBoot({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const tokenRaw = params.t;
  const token = Array.isArray(tokenRaw) ? tokenRaw[0] : tokenRaw;
  // Qualtrics ResponseID of the pre-interview survey, piped into the entry
  // link by the pre-survey's End-of-Survey redirect. Absent for the older
  // one-shot recruitment links, which carry identity in the token itself.
  const ridRaw = params.rid;
  const rid = Array.isArray(ridRaw) ? ridRaw[0] : ridRaw;

  if (!token) {
    return (
      <main className="mx-auto w-full max-w-xl px-6 py-16 text-center">
        <h1 className="font-semibold text-2xl">Missing invitation</h1>
        <p className="mt-3 text-muted-foreground text-sm">
          This page requires an invitation link. Please use the link from your
          recruitment email.
        </p>
      </main>
    );
  }

  return (
    <ChatClient invitationToken={token} qualtricsResponseId={rid ?? null} />
  );
}

export default function ChatPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  return (
    <Suspense fallback={<BootFallback />}>
      <ChatBoot searchParams={searchParams} />
    </Suspense>
  );
}

function BootFallback() {
  return (
    <main className="mx-auto w-full max-w-xl px-6 py-16 text-center">
      <p className="text-muted-foreground text-sm">Loading interview…</p>
    </main>
  );
}
