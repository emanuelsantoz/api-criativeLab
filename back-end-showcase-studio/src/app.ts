import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { projectRoutes } from './modules/router/project.routes';
import { courseRoutes } from './modules/router/courses.routes';
import { authRoutes } from './modules/router/auth.routes';
import { publicSubmissionRoutes } from './modules/router/public-submission.routes';
import { publicFeedbackRoutes } from './modules/router/public-feedback.routes';
import { moderationRoutes } from './modules/router/moderation.routes';
import { semesterRoutes } from './modules/router/semester.routes';
import { userRoutes } from './modules/router/users.routes';
import { dashboardRoutes } from './modules/router/dashboard.routes';
import { institutionRoutes } from './modules/router/institutions.routes';
import { env } from './config/env';
import { NoOpenSemesterError, SemesterCourseConfigurationError, SemesterDeletionError } from './modules/services/semester.service';
import { MediaStorageError } from './modules/storage/media.storage';
import { MediaValidationError } from './modules/storage/media-validation';
import { enforceRateLimit } from './modules/security/rate-limit';
import { DirectUploadError } from './modules/storage/direct-upload.service';

const app = new Hono().basePath('/api/v1');

app.get('/healthz', (c) => c.json({ status: 'ok' }));
app.use('*', logger());

const configuredOrigins = env.CORS_ORIGIN
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = env.NODE_ENV === 'production'
  ? Array.from(new Set([
    'https://criativelab.tech',
    'https://www.criativelab.tech',
    ...configuredOrigins,
  ]))
  : configuredOrigins.length > 0 ? configuredOrigins : ['*'];
const allowsAnyOrigin = allowedOrigins.includes('*');

app.use('*', cors({
  origin: allowsAnyOrigin ? '*' : (origin) => allowedOrigins.includes(origin) ? origin : undefined,
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: !allowsAnyOrigin,
  maxAge: 86400,
}));

app.use('*', async (c, next) => {
  // A API responde apenas JSON; esta CSP não interfere nos iframes do front-end.
  c.header('Content-Security-Policy', "default-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  await next();
});

// Proteção básica por instância. O WAF/rate limit da Vercel continua necessário
// para aplicar a mesma política entre todas as instâncias serverless.
app.use('*', enforceRateLimit({ scope: 'api', limit: 180, windowMs: 60_000 }));

app.onError((err, c) => {
  console.error('[Error Handler]', {
    name: err.name,
    message: err.message,
    stack: err.stack,
  });
  if (err instanceof MediaStorageError) {
    const status = err.code === 'R2_NOT_CONFIGURED' ? 503 : 502;
    return c.json({ error: 'Media Storage Error', message: err.publicMessage }, status);
  }
  if (err instanceof MediaValidationError) return c.json({ error: 'Unprocessable Entity', message: err.message }, 422);
  if (err instanceof DirectUploadError) return c.json({ error: 'Unprocessable Entity', message: err.message }, 422);
  if (err instanceof NoOpenSemesterError) return c.json({ error: 'Conflict', message: err.message }, 409);
  if (err instanceof z.ZodError) return c.json({ error: 'Bad Request', message: 'Dados de submissão inválidos.', details: err.issues }, 400);
  if (err instanceof SemesterCourseConfigurationError) return c.json({ error: 'Unprocessable Entity', message: err.message }, 422);
  if (err instanceof SemesterDeletionError) return c.json({ error: 'Conflict', message: err.message }, 409);
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2025') return c.json({ error: 'Not Found', message: 'Resource not found.' }, 404);
    if (err.code === 'P2002') return c.json({ error: 'Conflict', message: 'A resource with this value already exists.' }, 409);
    if (err.code === 'P2003') return c.json({ error: 'Unprocessable Entity', message: 'A referenced resource does not exist.' }, 422);
  }
  const message = env.NODE_ENV === 'production' ? 'Ocorreu um erro inesperado no servidor.' : err.message;
  return c.json({ error: 'Internal Server Error', message }, 500);
});

app.route('/projects', projectRoutes);
app.route('/courses', courseRoutes);
app.route('/auth', authRoutes);
app.route('/public/submissions', publicSubmissionRoutes);
app.route('/public/feedback', publicFeedbackRoutes);
app.route('/moderation', moderationRoutes);
app.route('/semesters', semesterRoutes);
app.route('/users', userRoutes);
app.route('/dashboard', dashboardRoutes);
app.route('/institutions', institutionRoutes);

export default app;
