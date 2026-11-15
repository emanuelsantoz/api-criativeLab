import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../../config/env';
import { prisma } from '../../db/prisma';
import { consumeRateLimit, enforceRateLimit } from '../security/rate-limit';

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
export const authRoutes = new Hono();

authRoutes.post('/login', enforceRateLimit({ scope: 'login-ip', limit: 20, windowMs: 15 * 60_000 }), zValidator('json', loginSchema), async (c) => {
  if (!env.JWT_SECRET) return c.json({ error: 'Service Unavailable', message: 'JWT_SECRET is not configured.' }, 503);
  const { email, password } = c.req.valid('json');
  const emailResult = consumeRateLimit({
    // Em paralelo ao limite por IP, o limite por conta evita força bruta
    // distribuída entre múltiplos endereços.
    key: `login-email:${email.trim().toLowerCase()}`,
    limit: 6,
    windowMs: 15 * 60_000,
  });
  if (!emailResult.allowed) {
    c.header('Retry-After', String(emailResult.retryAfterSeconds));
    return c.json({ error: 'Too Many Requests', message: 'Muitas tentativas de acesso. Tente novamente mais tarde.' }, 429);
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user?.password || !(await bcrypt.compare(password, user.password))) {
    return c.json({ error: 'Unauthorized', message: 'Invalid email or password.' }, 401);
  }
  const safeUser = { id: user.id, name: user.name, email: user.email, role: user.role, courseId: user.courseId };
  const token = jwt.sign({ id: user.id, role: user.role }, env.JWT_SECRET, { expiresIn: '8h' });
  return c.json({ data: { token, user: safeUser } });
});
