"use client";

import { useEffect, useRef, useState } from "react";

type RecorderState = "idle" | "recording" | "ready" | "unsupported" | "error";

type FieldVoiceNoteRecorderProps = {
  inputName: string;
};

export function FieldVoiceNoteRecorder({
  inputName,
}: FieldVoiceNoteRecorderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [state, setState] = useState<RecorderState>("idle");
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);

  useEffect(() => {
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setState("unsupported");
    }

    return () => {
      stopStreamTracks();
      if (recordingUrl) {
        URL.revokeObjectURL(recordingUrl);
      }
    };
  }, [recordingUrl]);

  async function startRecording() {
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setState("unsupported");

      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = resolveMediaRecorderMimeType();
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );

      chunksRef.current = [];
      streamRef.current = stream;
      recorderRef.current = recorder;

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      });

      recorder.addEventListener("stop", () => {
        const mimeType = recorder.mimeType || "audio/webm";
        const audioBlob = new Blob(chunksRef.current, { type: mimeType });
        const extension = mimeType.includes("mp4") ? "m4a" : "webm";
        const audioFile = new File([audioBlob], `voice-note.${extension}`, {
          type: mimeType,
        });
        const dataTransfer = new DataTransfer();

        dataTransfer.items.add(audioFile);

        if (inputRef.current) {
          inputRef.current.files = dataTransfer.files;
          inputRef.current.dispatchEvent(
            new Event("change", { bubbles: true }),
          );
        }

        setRecordingUrl((currentUrl) => {
          if (currentUrl) {
            URL.revokeObjectURL(currentUrl);
          }

          return URL.createObjectURL(audioBlob);
        });
        stopStreamTracks();
        setState("ready");
      });

      recorder.start();
      setState("recording");
    } catch {
      stopStreamTracks();
      setState("error");
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
  }

  function stopStreamTracks() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }

  const canRecord = state === "idle" || state === "ready" || state === "error";

  return (
    <div className="voice-recorder">
      <input
        accept="audio/webm,audio/mp4,audio/aac,audio/mpeg,audio/wav,.m4a,.mp3,.wav,.webm"
        name={inputName}
        ref={inputRef}
        required
        type="file"
      />
      <div className="voice-recorder-controls">
        <button
          className="secondary-button"
          disabled={!canRecord}
          onClick={startRecording}
          type="button"
        >
          Record
        </button>
        <button
          className="secondary-button"
          disabled={state !== "recording"}
          onClick={stopRecording}
          type="button"
        >
          Stop
        </button>
      </div>
      {recordingUrl ? (
        <audio className="voice-recorder-player" controls src={recordingUrl}>
          <track kind="captions" />
        </audio>
      ) : null}
      {state === "unsupported" ? (
        <p className="form-hint">Browser recording is unavailable here.</p>
      ) : null}
      {state === "error" ? (
        <p className="form-hint">Microphone access was not available.</p>
      ) : null}
    </div>
  );
}

function resolveMediaRecorderMimeType(): string | undefined {
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
    return "audio/webm;codecs=opus";
  }

  if (MediaRecorder.isTypeSupported("audio/mp4")) {
    return "audio/mp4";
  }

  return undefined;
}
