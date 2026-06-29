import { Module } from "@nestjs/common";

import { AiService } from "./ai.service";
import { OpenAiExtractionClient } from "./openai-extraction.client";
import { OpenAiTranscriptionClient } from "./openai-transcription.client";

@Module({
  providers: [AiService, OpenAiTranscriptionClient, OpenAiExtractionClient],
  exports: [AiService],
})
export class AiModule {}
