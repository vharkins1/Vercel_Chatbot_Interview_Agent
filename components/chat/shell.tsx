"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useActiveChat } from "@/hooks/use-active-chat";
import {
  initialArtifactData,
  useArtifact,
  useArtifactSelector,
} from "@/hooks/use-artifact";
import type { Attachment, ChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { Condition, StudyPhase } from "@/lib/study/protocol";
import { StudyProgressBar } from "@/components/study/progress-bar";
import { SurveyForm } from "@/components/study/survey-form";
import { Artifact } from "./artifact";
import { DataStreamHandler } from "./data-stream-handler";
import { submitEditedMessage } from "./message-editor";
import { Messages } from "./messages";
import { MultimodalInput } from "./multimodal-input";

/**
 * TEMPORARY: Demo banner. Remove for production.
 */
function DemoBanner({
  useSummarization,
  onSummarizationChange,
  onReset,
}: {
  useSummarization: boolean;
  onSummarizationChange: (v: boolean) => void;
  onReset: () => void;
}) {
  return (
    <div className="w-full border-b border-red-900/30 bg-red-950/40 px-4 py-2.5 text-sm">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
            <span className="font-semibold tracking-wider uppercase text-xs text-red-200">Demo</span>
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={useSummarization}
              onChange={(e) => onSummarizationChange(e.target.checked)}
              className="h-3 w-3 rounded-sm border border-red-900/50 bg-red-950 text-red-500 focus:ring-1 focus:ring-red-500 cursor-pointer accent-red-500"
            />
            <span className="font-medium text-red-300/70">Summarization</span>
          </label>

          <button
            type="button"
            onClick={onReset}
            className="rounded px-2 py-1 font-medium text-red-300/70 hover:bg-red-900/50 hover:text-red-200 transition-colors"
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}

export function ChatShell() {
  const {
    chatId,
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    regenerate,
    addToolApprovalResponse,
    input,
    setInput,
    visibilityType,
    isReadonly,
    isLoading,
    votes,
    currentModelId,
    setCurrentModelId,
    showCreditCardAlert,
    setShowCreditCardAlert,
  } = useActiveChat();

  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(
    null,
  );
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const isArtifactVisible = useArtifactSelector((state) => state.isVisible);
  const { setArtifact } = useArtifact();

  // ── Study State ────────────────────────────────────────────
  // TEMPORARY: Always start in study mode for the demo.
  // Change to false + env-var gating for production.
  const [isStudyMode, setIsStudyMode] = useState(true);
  const [studyPhase, setStudyPhase] = useState<StudyPhase>("welcome");
  const [studyTopicIndex, setStudyTopicIndex] = useState(0);
  const [studyQuestionIndex, setStudyQuestionIndex] = useState(0);
  const [useSummarization, setUseSummarization] = useState(false);
  const [studyCondition, setStudyCondition] = useState<Condition>("positive");

  // Load existing study session state (for resumed chats)
  useEffect(() => {
    if (!chatId) return;
    fetch(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/study-session?chatId=${chatId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.studySession) {
          setIsStudyMode(true);
          setStudyPhase(data.studySession.phase);
          setStudyTopicIndex(data.studySession.currentTopicIndex);
          setStudyQuestionIndex(data.studySession.currentQuestionIndex);
        }
      })
      .catch(() => {});
  }, [chatId]);

  const handleStartStudy = useCallback(
    async (condition: Condition) => {
      setStudyCondition(condition); // sync shell state
      setIsStudyMode(true);
      setStudyPhase("consent");

      // Push to a chat URL so the chat route creates the Chat row
      window.history.pushState(
        {},
        "",
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/chat/${chatId}`,
      );

      // Send the first message — the chat route will see no study session
      // exists and will create one using the condition from the body
      sendMessage({
        role: "user" as const,
        parts: [{ type: "text" as const, text: "I'm ready to begin the interview." }],
      }, {
        body: {
          studyCondition: condition,
          studyOptions: { useSummarization },
        },
      });
    },
    [chatId, sendMessage, useSummarization],
  );

  const handleReset = useCallback(() => {
    // Clear messages and reset to welcome screen with a fresh chat ID
    setMessages([]);
    setStudyPhase("welcome");
    setStudyTopicIndex(0);
    setStudyQuestionIndex(0);
    // Navigate to root to get a new chat ID
    window.location.href = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/`;
  }, [setMessages]);

  const handleSurveySubmit = useCallback(
    async (surveyData: Record<string, number>) => {
      await fetch(
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/study-session`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId, surveyData }),
        },
      );
      // Survey submission also handled via PATCH-like behavior
      // For now, just update local state
      setStudyPhase("complete");
    },
    [chatId],
  );

  const stopRef = useRef(stop);
  stopRef.current = stop;

  const prevChatIdRef = useRef(chatId);
  useEffect(() => {
    if (prevChatIdRef.current !== chatId) {
      prevChatIdRef.current = chatId;
      stopRef.current();
      setArtifact(initialArtifactData);
      setEditingMessage(null);
      setAttachments([]);
      // Reset study state on chat switch
      setIsStudyMode(true); // DEMO: always start in study mode
      setStudyPhase("welcome");
      setStudyTopicIndex(0);
      setStudyQuestionIndex(0);
    }
  }, [chatId, setArtifact]);

  return (
    <>
      <div className="flex h-dvh w-full flex-col overflow-hidden">
        {/* TEMPORARY: Demo banner */}
        {isStudyMode && (
          <DemoBanner
            useSummarization={useSummarization}
            onSummarizationChange={setUseSummarization}
            onReset={handleReset}
          />
        )}

        <div className="flex flex-1 min-h-0 flex-row overflow-hidden">
          <div
            className={cn(
              "flex min-w-0 flex-col bg-sidebar transition-[width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
              isArtifactVisible && !isStudyMode ? "w-[40%]" : "w-full",
            )}
          >
            <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
              {/* Study progress bar */}
              {isStudyMode && studyPhase !== "welcome" && studyPhase !== "consent" && studyPhase !== "complete" && (
                <StudyProgressBar
                  phase={studyPhase}
                  topicIndex={studyTopicIndex}
                  questionIndex={studyQuestionIndex}
                />
              )}

              <Messages
                addToolApprovalResponse={addToolApprovalResponse}
                chatId={chatId}
                isArtifactVisible={isArtifactVisible && !isStudyMode}
                isLoading={isLoading}
                isReadonly={isReadonly || studyPhase === "complete"}
                isStudyMode={isStudyMode}
                messages={messages}
                onEditMessage={(msg) => {
                  if (isStudyMode) return; // no editing in study mode
                  const text = msg.parts
                    ?.filter((p) => p.type === "text")
                    .map((p) => p.text)
                    .join("");
                  setInput(text ?? "");
                  setEditingMessage(msg);
                }}
                onStartStudy={handleStartStudy}
                regenerate={regenerate}
                selectedModelId={currentModelId}
                setMessages={setMessages}
                status={status}
                studyPhase={studyPhase}
                votes={votes}
              />

              {/* Hide input on welcome, show survey on complete, show chat input otherwise */}
              {isStudyMode && studyPhase === "welcome" ? null
              : isStudyMode && studyPhase === "complete" ? (
                <SurveyForm onSubmit={handleSurveySubmit} />
              ) : (
                <div className="sticky bottom-0 z-1 mx-auto flex w-full max-w-4xl gap-2 border-t-0 bg-background px-2 pb-3 md:px-4 md:pb-4">
                  {!isReadonly && (
                    <MultimodalInput
                      attachments={attachments}
                      chatId={chatId}
                      editingMessage={editingMessage}
                      input={input}
                      isLoading={isLoading}
                      isStudyMode={isStudyMode}
                      messages={messages}
                      onCancelEdit={() => {
                        setEditingMessage(null);
                        setInput("");
                      }}
                      onModelChange={setCurrentModelId}
                      selectedModelId={currentModelId}
                      sendMessage={
                        editingMessage
                          ? async () => {
                              const msg = editingMessage;
                              setEditingMessage(null);
                              await submitEditedMessage({
                                message: msg,
                                text: input,
                                setMessages,
                                regenerate,
                              });
                              setInput("");
                            }
                          : isStudyMode
                            ? (msg: any, opts?: any) => sendMessage(msg, { ...opts, body: { ...opts?.body, studyOptions: { useSummarization } } })
                            : sendMessage
                      }
                      setAttachments={setAttachments}
                      setInput={setInput}
                      setMessages={setMessages}
                      status={status}
                      stop={stop}
                    />
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Hide artifact panel in study mode */}
          {!isStudyMode && (
            <Artifact
              addToolApprovalResponse={addToolApprovalResponse}
              attachments={attachments}
              chatId={chatId}
              input={input}
              isReadonly={isReadonly}
              messages={messages}
              regenerate={regenerate}
              selectedModelId={currentModelId}
              selectedVisibilityType={visibilityType}
              sendMessage={sendMessage}
              setAttachments={setAttachments}
              setInput={setInput}
              setMessages={setMessages}
              status={status}
              stop={stop}
              votes={votes}
            />
          )}
        </div>
      </div>

      <DataStreamHandler
        onStudyStateChange={(state) => {
          setStudyPhase(state.phase);
          setStudyTopicIndex(state.topicIndex);
          setStudyQuestionIndex(state.questionIndex);
        }}
      />

      <AlertDialog
        onOpenChange={setShowCreditCardAlert}
        open={showCreditCardAlert}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Activate AI Gateway</AlertDialogTitle>
            <AlertDialogDescription>
              This application requires{" "}
              {process.env.NODE_ENV === "production" ? "the owner" : "you"} to
              activate Vercel AI Gateway.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                window.open(
                  "https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%3Fmodal%3Dadd-credit-card",
                  "_blank",
                );
                window.location.href = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/`;
              }}
            >
              Activate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
