import { Injectable } from "@nestjs/common";
import type { SegmentTemplate } from "@prisma/client";

import {
  getAiExtractionSchema,
  type AiExtractionSchema,
} from "./ai-extraction.schemas";

@Injectable()
export class AiService {
  getExtractionSchema(segmentTemplate: SegmentTemplate): AiExtractionSchema {
    return getAiExtractionSchema(segmentTemplate);
  }
}
