import { Module } from "@nestjs/common";

import { StorageModule } from "../storage/storage.module";
import { AiService } from "./ai.service";
import { OpenAiExtractionClient } from "./openai-extraction.client";
import { OpenAiTranscriptionClient } from "./openai-transcription.client";

@Module({
  imports: [StorageModule],
  providers: [AiService, OpenAiTranscriptionClient, OpenAiExtractionClient],
  exports: [AiService],
})
export class AiModule {}
