import { ProjectStatus, ReviewDecision } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { AccessTokenService } from './access-token.service';
import { NotificationService } from './notification.service';

const details = {
  course: true,
  semester: true,
  presentation: true,
  members: { include: { user: { select: { id: true, name: true } } } },
  contributors: true,
  _count: { select: { likes: true } },
  reviews: { orderBy: { createdAt: 'desc' as const }, include: { reviewer: { select: { id: true, name: true, email: true } } } },
} as const;

export class ReviewService {
  private readonly accessTokens = new AccessTokenService();
  private readonly notifications = new NotificationService();

  async list(page: number, limit: number, status?: string) {
    const where = status === 'APPROVED'
      ? { status: ProjectStatus.APPROVED }
      : status === 'REJECTED'
      ? { status: ProjectStatus.REJECTED }
      : status === 'CHANGES_REQUESTED'
      ? { status: ProjectStatus.CHANGES_REQUESTED }
      : { status: { in: [ProjectStatus.PENDING_REVIEW, ProjectStatus.CHANGES_REQUESTED] } };
    const [data, total] = await prisma.$transaction([
      prisma.project.findMany({ where, include: details, orderBy: { updatedAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      prisma.project.count({ where }),
    ]);
    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  getProject(id: string) {
    return prisma.project.findUnique({ where: { id }, include: details });
  }

  async approve(projectId: string, reviewerId: string) {
    await prisma.projectAccessToken.updateMany({ where: { projectId, usedAt: null }, data: { usedAt: new Date() } });
    return prisma.$transaction(async (tx) => {
      const project = await tx.project.update({
        where: { id: projectId },
        data: { status: ProjectStatus.APPROVED, publishedAt: new Date() },
      });
      await tx.projectReview.create({ data: { projectId, reviewerId, decision: ReviewDecision.APPROVED } });
      return project;
    });
  }

  async requestChanges(projectId: string, reviewerId: string, reason: string) {
    const project = await prisma.$transaction(async (tx) => {
      const updated = await tx.project.update({ where: { id: projectId }, data: { status: ProjectStatus.CHANGES_REQUESTED } });
      await tx.projectReview.create({ data: { projectId, reviewerId, decision: ReviewDecision.CHANGES_REQUESTED, reason } });
      return updated;
    });

    const access = await this.accessTokens.create(projectId);
    const notification = project.submitterEmail
      ? await this.notifications.sendChangesRequested({ projectId, recipient: project.submitterEmail, reason, token: access.token })
      : { editUrl: null, sent: false };
    return { project, editUrl: notification.editUrl, emailSent: notification.sent };
  }

  async reject(projectId: string, reviewerId: string, reason: string) {
    await prisma.projectAccessToken.updateMany({ where: { projectId, usedAt: null }, data: { usedAt: new Date() } });
    return prisma.$transaction(async (tx) => {
      const project = await tx.project.update({ where: { id: projectId }, data: { status: ProjectStatus.REJECTED } });
      await tx.projectReview.create({ data: { projectId, reviewerId, decision: ReviewDecision.REJECTED, reason } });
      return project;
    });
  }
}
