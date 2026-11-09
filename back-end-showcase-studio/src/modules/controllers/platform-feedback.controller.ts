import type { Context } from "hono";
import { createHash } from "node:crypto";
import { prisma } from "../../db/prisma";
import { AuditService } from "../services/audit.service";
import { platformFeedbackSchema } from "../schemas/platform-feedback.schema";

const audit = new AuditService();

export class PlatformFeedbackController {
  async create(c: Context) {
    const input = platformFeedbackSchema.parse(await c.req.json());
    const visitorHash = createHash("sha256")
      .update(input.visitorId)
      .digest("hex");
    const day = startUtcDay(new Date());
    const existing = await prisma.platformFeedback.findUnique({
      where: { visitorHash_day: { visitorHash, day } },
      select: { id: true },
    });
    if (existing) {
      return c.json(
        {
          error: "Conflict",
          message:
            "Você já enviou uma avaliação hoje. Obrigado pela contribuição.",
        },
        409,
      );
    }

    const feedback = await prisma.platformFeedback.create({
      data: {
        visitorHash,
        day,
        rating: input.rating,
        type: input.type,
        topic: input.topic,
        message: input.message,
      },
      select: { id: true, createdAt: true },
    });
    await audit
      .record({
        action: "platform-feedback-created",
        resource: "platform-feedback",
        resourceId: feedback.id,
        metadata: {
          type: input.type,
          topic: input.topic,
          hasRating: Boolean(input.rating),
        },
      })
      .catch((error) =>
        console.error("[Audit] platform feedback record failed", {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return c.json({ data: feedback }, 201);
  }
}

function startUtcDay(date: Date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}
