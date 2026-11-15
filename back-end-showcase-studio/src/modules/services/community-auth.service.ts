import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { env } from '../../config/env';
import { prisma } from '../../db/prisma';

const TOKEN_TTL_MS = 15 * 60_000;
const SESSION_TTL = '7d';

function hashToken(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export class CommunityAuthService {
  async requestAccess(email: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

    await prisma.$transaction([
      prisma.communityAccessToken.updateMany({
        where: { email: normalizedEmail, usedAt: null },
        data: { usedAt: new Date() },
      }),
      prisma.communityAccessToken.create({
        data: { email: normalizedEmail, tokenHash: hashToken(token), expiresAt },
      }),
    ]);

    return { token };
  }

  async verifyAccess(token: string) {
    if (!env.JWT_SECRET) throw new Error('JWT_SECRET is not configured.');
    const tokenHash = hashToken(token);
    const now = new Date();

    const user = await prisma.$transaction(async (tx) => {
      const access = await tx.communityAccessToken.findUnique({ where: { tokenHash } });
      if (!access || access.usedAt || access.expiresAt <= now) return null;

      const consumed = await tx.communityAccessToken.updateMany({
        where: { id: access.id, usedAt: null },
        data: { usedAt: now },
      });
      if (consumed.count !== 1) return null;

      return tx.user.upsert({
        where: { email: access.email },
        create: {
          email: access.email,
          role: Role.COMMUNITY_MEMBER,
          communityEnabled: true,
        },
        update: { communityEnabled: true },
        select: { id: true, name: true, email: true, role: true, communityEnabled: true },
      });
    });

    if (!user) return null;
    const session = jwt.sign(
      {
        id: user.id,
        role: Role.COMMUNITY_MEMBER,
        communityEnabled: true,
        communityAccess: true,
      },
      env.JWT_SECRET,
      { expiresIn: SESSION_TTL },
    );
    return {
      token: session,
      user: { ...user, role: Role.COMMUNITY_MEMBER, communityEnabled: true },
    };
  }

  async getProfile(userId: string) {
    return prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, bio: true, avatarUrl: true, role: true, communityEnabled: true },
    });
  }
}
