import { Injectable } from "@nestjs/common";

import type { TranscriptionAudioInput, TranscriptionResult } from "./ai.types";

const OPENAI_AUDIO_TRANSCRIPTIONS_URL =
  "https://api.openai.com/v1/audio/transcriptions";

@Injectable()
export class OpenAiTranscriptionClient {
  async transcribe(
    audio: TranscriptionAudioInput,
    model: string,
  ): Promise<TranscriptionResult> {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not configured.");
    }

    const formData = new FormData();
    const audioBuffer = audio.data.buffer.slice(
      audio.data.byteOffset,
      audio.data.byteOffset + audio.data.byteLength,
    ) as ArrayBuffer;
    const audioBlob = new Blob([audioBuffer], { type: audio.contentType });

    formData.set("model", model);
    formData.set("file", audioBlob, audio.fileName);

    const response = await fetch(OPENAI_AUDIO_TRANSCRIPTIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`OpenAI transcription failed with ${response.status}.`);
    }

    const payload = (await response.json()) as { text?: unknown };

    if (typeof payload.text !== "string" || !payload.text.trim()) {
      throw new Error("OpenAI transcription response did not include text.");
    }

    return { text: payload.text };
  }
}
