import { Module } from "@nestjs/common";

import { AiService } from "./ai.service";
import { OpenAiTranscriptionClient } from "./openai-transcription.client";

@Module({
  providers: [AiService, OpenAiTranscriptionClient],
  exports: [AiService],
})
export class AiModule {}
