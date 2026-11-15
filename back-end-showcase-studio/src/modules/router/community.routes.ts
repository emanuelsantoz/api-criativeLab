import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireAuth, requireCommunityMember, type AuthUser } from '../auth';
import { consumeRateLimit, enforceRateLimit } from '../security/rate-limit';
import { CommunityAuthService } from '../services/community-auth.service';
import { NotificationService } from '../services/notification.service';

const router = new Hono<{ Variables: { user: AuthUser } }>();
const communityAuth = new CommunityAuthService();
const notifications = new NotificationService();
const emailSchema = z.object({ email: z.string().trim().email() });
const tokenSchema = z.object({ token: z.string().trim().min(32).max(256) });

router.post(
  '/auth/request-link',
  enforceRateLimit({ scope: 'community-access-ip', limit: 8, windowMs: 15 * 60_000 }),
  zValidator('json', emailSchema),
  async (c) => {
    const { email } = c.req.valid('json');
    const normalizedEmail = email.toLowerCase();
    const emailLimit = consumeRateLimit({
      key: `community-access-email:${normalizedEmail}`,
      limit: 3,
      windowMs: 15 * 60_000,
    });
    if (!emailLimit.allowed) {
      c.header('Retry-After', String(emailLimit.retryAfterSeconds));
      return c.json({ error: 'Too Many Requests', message: 'Muitas solicitações. Tente novamente mais tarde.' }, 429);
    }

    const access = await communityAuth.requestAccess(normalizedEmail);
    await notifications.sendCommunityAccessLink({ recipient: normalizedEmail, token: access.token });
    return c.json({ message: 'Se o endereço estiver correto, você receberá um link de acesso em instantes.' });
  },
);

router.post(
  '/auth/verify',
  enforceRateLimit({ scope: 'community-verify', limit: 12, windowMs: 15 * 60_000 }),
  zValidator('json', tokenSchema),
  async (c) => {
    const { token } = c.req.valid('json');
    const session = await communityAuth.verifyAccess(token);
    if (!session) {
      return c.json({ error: 'Unauthorized', message: 'Este link é inválido, expirou ou já foi utilizado.' }, 401);
    }
    return c.json({ data: session });
  },
);

router.get('/me', requireAuth, requireCommunityMember, async (c) => {
  const user = c.get('user');
  const profile = await communityAuth.getProfile(user.id);
  if (!profile) return c.json({ error: 'Not Found', message: 'Perfil não encontrado.' }, 404);
  return c.json({ data: profile });
});

export const communityRoutes = router;
