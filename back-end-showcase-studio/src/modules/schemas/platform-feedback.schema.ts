import { z } from "zod";

export const platformFeedbackSchema = z
  .object({
    visitorId: z.string().uuid(),
    rating: z.number().int().min(1).max(5).optional(),
    type: z.enum(["SUGGESTION", "PROBLEM", "PRAISE"]),
    topic: z.enum([
      "SUBMISSION_FORM",
      "SUPPORT_CHANNEL",
      "SEARCH_SYSTEM",
      "PROJECT_EVALUATION",
    ]),
    message: z.string().trim().min(5).max(1200),
  })
  .strict();
