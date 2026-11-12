import { prisma } from '../../db/prisma';
import { Prisma, ProjectStatus, StorageProvider } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { deleteMedia, resolveStorageProvider, uploadMedia, type UploadableMedia } from '../storage/media.storage';
import { NoOpenSemesterError, SemesterCourseConfigurationError, SemesterService } from './semester.service';
import { projectSlugBase } from '../utils/project-slug';

const details = {
  course: true,
  semester: true,
  presentation: true,
  members: { include: { user: { select: { id: true, name: true } } } },
  contributors: true,
  _count: { select: { likes: true } },
} as const;

// Nunca use `include` em uma resposta pública: ele retorna todos os campos
// escalares do projeto, inclusive e-mails. Este select é a fronteira de dados
// entre a curadoria e o portfólio público.
const publicProjectSelect = {
  id: true,
  // O slug é o identificador canônico da URL pública. Sem ele o frontend
  // precisa cair no UUID e não consegue preservar links legíveis.
  slug: true,
  title: true,
  shortDescription: true,
  description: true,
  thumbnailUrl: true,
  status: true,
  isFeatured: true,
  viewsCount: true,
  likesCount: true,
  tags: true,
  liveUrl: true,
  prototypeUrl: true,
  repositoryUrl: true,
  courseId: true,
  className: true,
  semesterId: true,
  submitterName: true,
  submitterAvatarUrl: true,
  submitterAvatarColor: true,
  createdAt: true,
  updatedAt: true,
  course: {
    select: {
      id: true,
      name: true,
      institution: { select: { id: true, name: true, slug: true, logoUrl: true } },
    },
  },
  semester: { select: { id: true, year: true, number: true, code: true, label: true, startsAt: true, endsAt: true } },
  presentation: { select: { id: true, projectId: true, type: true, url: true } },
  members: { select: { roleInfo: true, user: { select: { id: true, name: true } } } },
  contributors: { select: { id: true, name: true, roleInfo: true, avatarUrl: true, avatarColor: true } },
  _count: { select: { likes: true } },
} as const;

type ProjectInput = {
  title: string;
  shortDescription: string;
  description: string;
  thumbnailUrl?: string;
  courseId: string;
  className: string;
  membersIds: string[];
  presentation?: { type: 'CANVA'; url: string };
  tags?: string[];
  liveUrl?: string;
  prototypeUrl?: string;
  repositoryUrl?: string;
  createdById: string;
};

export class ProjectService {
  private readonly semesters = new SemesterService();

  private async createUniqueSlug(title: string) {
    const base = projectSlugBase(title);
    const existing = await prisma.project.findMany({
      where: { slug: { startsWith: base } },
      select: { slug: true },
    });
    const used = new Set(existing.map((project) => project.slug));

    if (!used.has(base)) return base;

    let sequence = 2;
    while (used.has(`${base}-${sequence}`)) sequence += 1;
    return `${base}-${sequence}`;
  }

  async listProjects(filters: { courseId?: string; institutionSlug?: string; semesterId?: string; isFeatured?: boolean; page: number; limit: number }) {
    const skip = (filters.page - 1) * filters.limit;
    const where: Prisma.ProjectWhereInput = { status: ProjectStatus.APPROVED };
    if (filters.courseId) where.courseId = filters.courseId;
    if (filters.institutionSlug) {
      where.course = { institution: { slug: filters.institutionSlug, active: true } };
    }
    if (filters.semesterId) where.semesterId = filters.semesterId;
    if (filters.isFeatured !== undefined) where.isFeatured = filters.isFeatured;

    const [projects, total] = await prisma.$transaction([
      prisma.project.findMany({ where, skip, take: filters.limit, select: publicProjectSelect, orderBy: { createdAt: 'desc' } }),
      prisma.project.count({ where }),
    ]);
    return { data: projects, meta: { total, page: filters.page, limit: filters.limit, totalPages: Math.ceil(total / filters.limit) } };
  }

  async getProject(identifier: string) {
    return prisma.project.findFirst({
      where: {
        status: ProjectStatus.APPROVED,
        OR: [{ id: identifier }, { slug: identifier }],
      },
      select: publicProjectSelect,
    });
  }

  async getPublicStats(institutionSlug?: string) {
    const projects = await prisma.project.findMany({
      where: { status: ProjectStatus.APPROVED, ...(institutionSlug ? { course: { institution: { slug: institutionSlug, active: true } } } : {}) },
      select: {
        courseId: true,
        viewsCount: true,
        likesCount: true,
        submitterName: true,
        submitterEmail: true,
        contributors: { select: { name: true, email: true } },
      },
    });
    const students = new Set<string>();
    const addStudent = (name: string | null | undefined, email: string | null | undefined) => {
      const identity = (email || name || '').trim().toLocaleLowerCase();
      if (identity) students.add(identity);
    };
    for (const project of projects) {
      addStudent(project.submitterName, project.submitterEmail);
      for (const contributor of project.contributors) addStudent(contributor.name, contributor.email);
    }
    return {
      publishedProjects: projects.length,
      participatingStudents: students.size,
      courses: new Set(projects.map((project) => project.courseId)).size,
      totalViews: projects.reduce((total, project) => total + project.viewsCount, 0),
      totalLikes: projects.reduce((total, project) => total + project.likesCount, 0),
    };
  }

  async createProject(data: ProjectInput) {
    const semester = await this.semesters.getCurrent();
    if (!semester) throw new NoOpenSemesterError();
    await this.semesters.assertCourseAcceptsProjects(semester.id, data.courseId, data.className, data.tags ?? []);
    return prisma.project.create({
      data: {
        slug: await this.createUniqueSlug(data.title),
        title: data.title,
        shortDescription: data.shortDescription,
        description: data.description,
        thumbnailUrl: data.thumbnailUrl,
        courseId: data.courseId,
        className: data.className,
        semesterId: semester.id,
        tags: data.tags ?? [],
        liveUrl: data.liveUrl,
        prototypeUrl: data.prototypeUrl,
        repositoryUrl: data.repositoryUrl,
        createdById: data.createdById,
        status: ProjectStatus.PENDING_REVIEW,
        members: { create: data.membersIds.map((userId) => ({ userId, roleInfo: 'Contributor' })) },
        ...(data.presentation ? {
          presentation: {
            create: { type: 'CANVA', url: data.presentation.url, storageProvider: 'CANVA' },
          },
        } : {}),
      },
      include: details,
    });
  }

  async incrementViews(id: string, visitorId: string) {
    const visitorHash = createHash('sha256').update(visitorId).digest('hex');
    const visible = await prisma.project.findFirst({ where: { id, status: ProjectStatus.APPROVED }, select: { id: true } });
    if (!visible) return null;
    return prisma.$transaction(async (tx) => {
      const existing = await tx.anonymousView.findUnique({ where: { projectId_visitorHash: { projectId: id, visitorHash } } });
      if (existing) {
        const project = await tx.project.findUniqueOrThrow({ where: { id }, select: { id: true, viewsCount: true } });
        return { ...project, counted: false };
      }
      await tx.anonymousView.create({ data: { projectId: id, visitorHash } });
      const project = await tx.project.update({ where: { id }, data: { viewsCount: { increment: 1 } }, select: { id: true, viewsCount: true } });
      return { ...project, counted: true };
    });
  }

  async toggleLike(projectId: string, userId: string) {
    return prisma.$transaction(async (tx) => {
      const project = await tx.project.findUnique({ where: { id: projectId }, select: { likesCount: true } });
      if (!project) throw new Error('Project not found');
      const like = await tx.like.findUnique({ where: { userId_projectId: { userId, projectId } } });
      const liked = !like;
      if (like) {
        await tx.like.delete({ where: { userId_projectId: { userId, projectId } } });
        await tx.project.update({ where: { id: projectId }, data: { likesCount: { decrement: 1 } } });
      } else {
        await tx.like.create({ data: { userId, projectId } });
        await tx.project.update({ where: { id: projectId }, data: { likesCount: { increment: 1 } } });
      }
      return { liked, likesCount: project.likesCount + (liked ? 1 : -1) };
    });
  }

  async toggleAnonymousLike(projectId: string, visitorId: string) {
    const visitorHash = createHash('sha256').update(visitorId).digest('hex');
    return prisma.$transaction(async (tx) => {
      const project = await tx.project.findFirst({ where: { id: projectId, status: ProjectStatus.APPROVED }, select: { likesCount: true } });
      if (!project) return null;
      const existing = await tx.anonymousLike.findUnique({ where: { projectId_visitorHash: { projectId, visitorHash } } });
      const liked = !existing;
      if (existing) {
        await tx.anonymousLike.delete({ where: { projectId_visitorHash: { projectId, visitorHash } } });
        await tx.project.update({ where: { id: projectId }, data: { likesCount: { decrement: 1 } } });
      } else {
        await tx.anonymousLike.create({ data: { projectId, visitorHash } });
        await tx.project.update({ where: { id: projectId }, data: { likesCount: { increment: 1 } } });
      }
      return { liked, likesCount: project.likesCount + (liked ? 1 : -1) };
    });
  }

  async updateStatus(id: string, status: ProjectStatus, isFeatured?: boolean) {
    return prisma.project.update({ where: { id }, data: { status, ...(isFeatured !== undefined && { isFeatured }) }, include: details });
  }

  async delete(id: string) {
    const project = await prisma.project.findUnique({
      where: { id },
      select: {
        thumbnailStorageProvider: true,
        thumbnailStorageKey: true,
        thumbnailUrl: true,
        presentation: { select: { storageProvider: true, storageKey: true, url: true } },
      },
    });
    if (!project) return null;

    await prisma.project.delete({ where: { id } });
    if (project.thumbnailStorageProvider) {
      await deleteMedia(project.thumbnailStorageProvider, project.thumbnailStorageKey || project.thumbnailUrl);
    }
    if (project.presentation?.storageProvider) {
      await deleteMedia(project.presentation.storageProvider, project.presentation.storageKey || project.presentation.url);
    }
    return { id };
  }

  async updateContent(
    id: string,
    data: {
      title: string;
      shortDescription: string;
      description: string;
      submitterName?: string;
      submitterEmail?: string;
      submitterAvatarUrl?: string | null;
      submitterAvatarColor?: string;
      thumbnail?: { url: string; key: string; provider: StorageProvider };
      contributors?: Array<{
        name: string;
        email?: string;
        roleInfo?: string;
        avatarUrl?: string | null;
        avatarColor?: string;
      }>;
      courseId?: string;
      semesterId?: string;
      className?: string;
      tags: string[];
      liveUrl?: string;
      prototypeUrl?: string;
      repositoryUrl?: string;
    },
  ) {
    const current = await prisma.project.findUnique({
      where: { id },
      select: {
        courseId: true,
        semesterId: true,
        className: true,
        thumbnailStorageProvider: true,
        thumbnailStorageKey: true,
        thumbnailUrl: true,
      },
    });
    if (!current) return null;

    const nextCourseId = data.courseId ?? current.courseId;
    const nextSemesterId = data.semesterId ?? current.semesterId;
    const nextClassName = data.className?.trim() || current.className;
    const associationChanged = nextCourseId !== current.courseId
      || nextSemesterId !== current.semesterId
      || nextClassName !== current.className;

    // Edições de texto/link não devem falhar por uma configuração histórica
    // de semestre. A vinculação só é validada quando o administrador a altera.
    if (associationChanged) {
      const offering = await prisma.semesterCourse.findUnique({
        where: { semesterId_courseId_className: { semesterId: nextSemesterId, courseId: nextCourseId, className: nextClassName } },
      });
      if (!offering) throw new SemesterCourseConfigurationError('A disciplina não está vinculada a essa turma e semestre.');
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (data.contributors !== undefined) {
        await tx.projectContributor.deleteMany({ where: { projectId: id } });
        if (data.contributors.length > 0) {
          await tx.projectContributor.createMany({
            data: data.contributors.map(({ name, email, roleInfo, avatarUrl, avatarColor }) => ({
              projectId: id,
              name: name.trim(),
              email: email?.trim() || null,
              roleInfo: roleInfo?.trim() || null,
              avatarUrl: avatarUrl?.trim() || null,
              avatarColor: avatarColor || null,
            })),
          });
        }
      }

      return tx.project.update({
        where: { id },
        data: {
          title: data.title.trim(),
          shortDescription: data.shortDescription.trim(),
          description: data.description.trim(),
          submitterName: data.submitterName?.trim(),
          submitterEmail: data.submitterEmail?.trim() || null,
          ...(data.submitterAvatarUrl !== undefined
            ? { submitterAvatarUrl: data.submitterAvatarUrl?.trim() || null }
            : {}),
          ...(data.submitterAvatarColor !== undefined
            ? { submitterAvatarColor: data.submitterAvatarColor }
            : {}),
          ...(data.thumbnail
            ? {
                thumbnailUrl: data.thumbnail.url,
                thumbnailStorageProvider: data.thumbnail.provider,
                thumbnailStorageKey: data.thumbnail.key,
              }
            : {}),
          ...(data.courseId !== undefined ? { courseId: nextCourseId } : {}),
          ...(data.semesterId !== undefined ? { semesterId: nextSemesterId } : {}),
          ...(data.className !== undefined ? { className: nextClassName } : {}),
          tags: [...new Set(data.tags.map((tag) => tag.trim()).filter(Boolean))],
          liveUrl: data.liveUrl?.trim() || null,
          prototypeUrl: data.prototypeUrl?.trim() || null,
          repositoryUrl: data.repositoryUrl?.trim() || null,
        },
        include: details,
      });
    });

    if (
      data.thumbnail &&
      current.thumbnailStorageProvider &&
      current.thumbnailStorageKey &&
      (current.thumbnailStorageProvider !== data.thumbnail.provider ||
        current.thumbnailStorageKey !== data.thumbnail.key)
    ) {
      await deleteMedia(
        current.thumbnailStorageProvider,
        current.thumbnailStorageKey || current.thumbnailUrl,
      ).catch((error) => {
        console.error('[ProjectService] previous thumbnail cleanup failed', {
          id,
          errorName: error instanceof Error ? error.name : 'UnknownError',
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      });
    }

    return updated;
  }

  async uploadAvatar(id: string, file: UploadableMedia) {
    const provider = resolveStorageProvider('CONTRIBUTOR_AVATAR');
    const extension = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : 'webp';
    return uploadMedia(`projects/${id}/avatars/${randomUUID()}.${extension}`, file, provider);
  }

  async canManageProject(id: string, userId: string, role: string) {
    const project = await prisma.project.findUnique({ where: { id }, select: { createdById: true } });
    if (!project) return false;
    return role === 'ADMIN' || role === 'COORDENADOR' || project.createdById === userId;
  }

  async setCanvaPresentation(id: string, url: string) {
    return prisma.projectPresentation.upsert({
      where: { projectId: id },
      create: { projectId: id, type: 'CANVA', url, storageProvider: 'CANVA' },
      update: { type: 'CANVA', url, storageProvider: 'CANVA', storageKey: null, contentType: null, sizeBytes: null },
    });
  }

  async uploadThumbnail(id: string, file: UploadableMedia) {
    const previous = await prisma.project.findUnique({ where: { id }, select: { thumbnailStorageProvider: true, thumbnailStorageKey: true, thumbnailUrl: true } });
    const provider = resolveStorageProvider('THUMBNAIL');
    const extension = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : 'webp';
    const stored = await uploadMedia(`projects/${id}/thumbnails/${randomUUID()}.${extension}`, file, provider);
    const updated = await prisma.project.update({
      where: { id },
      data: { thumbnailUrl: stored.url, thumbnailStorageProvider: stored.provider, thumbnailStorageKey: stored.key },
      include: details,
    });
    if (previous?.thumbnailStorageProvider && previous.thumbnailStorageKey
      && (previous.thumbnailStorageProvider !== stored.provider || previous.thumbnailStorageKey !== stored.key)) {
      // A nova thumbnail já foi salva; a limpeza da antiga não deve desfazer a atualização.
      await deleteMedia(previous.thumbnailStorageProvider, previous.thumbnailStorageKey || previous.thumbnailUrl).catch((error) => {
        console.error('[ProjectService] previous thumbnail cleanup failed', {
          id,
          errorName: error instanceof Error ? error.name : 'UnknownError',
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      });
    }
    return updated;
  }

  async uploadPdf(id: string, file: UploadableMedia) {
    const previous = await prisma.projectPresentation.findUnique({ where: { projectId: id } });
    const stored = await uploadMedia(`projects/${id}/presentation.pdf`, file, resolveStorageProvider('PRESENTATION_PDF'));
    const presentation = await prisma.projectPresentation.upsert({
      where: { projectId: id },
      create: { projectId: id, type: 'PDF', url: stored.url, storageProvider: stored.provider, storageKey: stored.key, contentType: file.type, sizeBytes: file.size },
      update: { type: 'PDF', url: stored.url, storageProvider: stored.provider, storageKey: stored.key, contentType: file.type, sizeBytes: file.size },
    });
    if (previous?.storageProvider && previous.storageKey) await deleteMedia(previous.storageProvider, previous.storageKey);
    return presentation;
  }

  async deletePresentation(id: string) {
    const previous = await prisma.projectPresentation.findUnique({ where: { projectId: id } });
    if (!previous) return null;
    await prisma.projectPresentation.delete({ where: { projectId: id } });
    await deleteMedia(previous.storageProvider, previous.storageKey || previous.url);
    return previous;
  }
}
