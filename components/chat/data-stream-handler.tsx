"use client";

import { useEffect } from "react";
import { initialArtifactData, useArtifact } from "@/hooks/use-artifact";
import type { StudyPhase } from "@/lib/study/protocol";
import { artifactDefinitions } from "./artifact";
import { useDataStream } from "./data-stream-provider";

type StudyState = {
  phase: StudyPhase;
  topicIndex: number;
  questionIndex: number;
};

export function DataStreamHandler({
  onStudyStateChange,
}: {
  onStudyStateChange?: (state: StudyState) => void;
}) {
  const { dataStream, setDataStream } = useDataStream();

  const { artifact, setArtifact, setMetadata } = useArtifact();

  useEffect(() => {
    if (!dataStream?.length) {
      return;
    }

    const newDeltas = dataStream.slice();
    setDataStream([]);

    for (const delta of newDeltas) {
      if (delta.type === "data-chat-title") {
        continue;
      }

      // Handle study state events
      if (delta.type === "data-study-state") {
        try {
          const state = JSON.parse(delta.data as string) as StudyState;
          onStudyStateChange?.(state);
        } catch {
          // ignore parse errors
        }
        continue;
      }

      const artifactDefinition = artifactDefinitions.find(
        (currentArtifactDefinition) =>
          currentArtifactDefinition.kind === artifact.kind,
      );

      if (artifactDefinition?.onStreamPart) {
        artifactDefinition.onStreamPart({
          streamPart: delta,
          setArtifact,
          setMetadata,
        });
      }

      setArtifact((draftArtifact) => {
        if (!draftArtifact) {
          return { ...initialArtifactData, status: "streaming" };
        }

        switch (delta.type) {
          case "data-id":
            return {
              ...draftArtifact,
              documentId: delta.data,
              status: "streaming",
            };

          case "data-title":
            return {
              ...draftArtifact,
              title: delta.data,
              status: "streaming",
            };

          case "data-kind":
            return {
              ...draftArtifact,
              kind: delta.data,
              status: "streaming",
            };

          case "data-clear":
            return {
              ...draftArtifact,
              content: "",
              status: "streaming",
            };

          case "data-finish":
            return {
              ...draftArtifact,
              status: "idle",
            };

          default:
            return draftArtifact;
        }
      });
    }
  }, [dataStream, setArtifact, setMetadata, artifact, setDataStream, onStudyStateChange]);

  return null;
}
