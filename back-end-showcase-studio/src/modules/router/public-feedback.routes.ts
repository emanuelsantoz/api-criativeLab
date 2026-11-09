import { Hono } from "hono";
import { PlatformFeedbackController } from "../controllers/platform-feedback.controller";
import { enforceContentLength, enforceRateLimit } from "../security/rate-limit";

export const publicFeedbackRoutes = new Hono();
const controller = new PlatformFeedbackController();

// A unicidade no banco limita a um feedback por navegador/dia; este limite reduz tentativas abusivas antes do banco.
publicFeedbackRoutes.post(
  "/",
  enforceRateLimit({
    scope: "platform-feedback",
    limit: 3,
    windowMs: 24 * 60 * 60_000,
  }),
  enforceContentLength(8 * 1024),
  (c) => controller.create(c),
);
