import { Context } from 'hono';
import { StorageProvider } from '@prisma/client';
import { ProjectService } from '../services/project.service';
import type { UploadableMedia } from '../storage/media.storage';
import { assertImageSignature, assertPdfSignature } from '../storage/media-validation';
import { DirectUploadService, type DirectUploadKind, type DirectUploadReference } from '../storage/direct-upload.service';
import { AuditService } from '../services/audit.service';

const projectService = new ProjectService();
const directUploads = new DirectUploadService();
const audit = new AuditService();

export class ProjectController {
  constructor() {
    // Hono recebe os handlers como callbacks. Sem o binding, os métodos que
    // usam `this.canManage()` perdem o contexto da instância em produção.
    this.updateContent = this.updateContent.bind(this);
    this.setCanvaPresentation = this.setCanvaPresentation.bind(this);
    this.uploadThumbnail = this.uploadThumbnail.bind(this);
    this.uploadAvatar = this.uploadAvatar.bind(this);
    this.authorizeUploads = this.authorizeUploads.bind(this);
    this.uploadPdf = this.uploadPdf.bind(this);
    this.deletePresentation = this.deletePresentation.bind(this);
  }

  async getAll(c: Context) {
    // A rota já passou pelo zValidator; a leitura abaixo preserva a tipagem
    // simples do Context compartilhado pelos handlers do Hono.
    const query = c.req.query();
    const result = await projectService.listProjects({
      courseId: query.courseId,
      institutionSlug: query.institutionSlug,
      semesterId: query.semesterId,
      isFeatured: query.isFeatured === undefined ? undefined : query.isFeatured === 'true',
      page: Number(query.page ?? '1'),
      limit: Number(query.limit ?? '12'),
    });
    return c.json(result, 200);
  }

  async create(c: Context) {
    const body = await c.req.json();
    const user = c.get('user') as { id: string };
    const project = await projectService.createProject({ ...body, createdById: user.id });
    return c.json({ data: project, message: 'Submissão efetuada com sucesso.', project }, 201);
  }

  async getById(c: Context) {
    const project = await projectService.getProject(c.req.param('id')!);
    if (!project) return c.json({ error: 'Not Found', message: 'Project not found.' }, 404);
    return c.json({ data: project }, 200);
  }

  async getPublicStats(c: Context) {
    const institutionSlug = c.req.query('institutionSlug');
    return c.json({ data: await projectService.getPublicStats(institutionSlug), institutionSlug: institutionSlug ?? null }, 200);
  }

  async incrementViews(c: Context) {
    const { visitorId } = await c.req.json<{ visitorId: string }>();
    const result = await projectService.incrementViews(c.req.param('id')!, visitorId);
    if (!result) return c.json({ error: 'Not Found', message: 'Projeto não encontrado.' }, 404);
    return c.json({ data: result }, 200);
  }

  async handleLike(c: Context) {
    const { visitorId } = await c.req.json<{ visitorId: string }>();
    const result = await projectService.toggleAnonymousLike(c.req.param('id')!, visitorId);
    if (!result) return c.json({ error: 'Not Found', message: 'Projeto não encontrado.' }, 404);
    return c.json({ data: result }, 200);
  }

  async moderate(c: Context) {
    const body = await c.req.json<{ status: 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED' | 'PENDING_REVIEW' | 'DRAFT'; isFeatured?: boolean }>();
    const updated = await projectService.updateStatus(c.req.param('id')!, body.status, body.isFeatured);
    const user = c.get('user') as { id: string };
    await audit.record({ actorUserId: user.id, action: 'project.status_updated', resource: 'project', resourceId: updated.id, metadata: { status: body.status, ...(body.isFeatured !== undefined ? { isFeatured: body.isFeatured } : {}) } });
    return c.json({ message: 'Status de moderação atualizado.', updated }, 200);
  }

  async remove(c: Context) {
    const projectId = c.req.param('id')!;
    const deleted = await projectService.delete(projectId);
    if (!deleted) return c.json({ error: 'Not Found', message: 'Projeto não encontrado.' }, 404);
    const user = c.get('user') as { id: string };
    await audit.record({ actorUserId: user.id, action: 'project.deleted', resource: 'project', resourceId: projectId });
    return c.json({ message: 'Projeto excluído.' }, 200);
  }

  async updateContent(c: Context) {
    if (!(await this.canManage(c))) return c.json({ error: 'Forbidden', message: 'You cannot edit this project.' }, 403);
    const body = await c.req.json<{
      title: string;
      shortDescription: string;
      description: string;
      submitterName?: string;
      submitterEmail?: string;
      submitterAvatarUrl?: string | null;
      submitterAvatarColor?: string;
      submitterAvatarUpload?: DirectUploadReference;
      thumbnailUpload?: DirectUploadReference;
      contributors?: Array<{
        name: string;
        email?: string;
        roleInfo?: string;
        avatarUrl?: string | null;
        avatarColor?: string;
        avatarUpload?: DirectUploadReference;
      }>;
      courseId?: string;
      semesterId?: string;
      className?: string;
      tags: string[];
      liveUrl?: string;
      prototypeUrl?: string;
      repositoryUrl?: string;
    }>();

    const verifiedThumbnail = body.thumbnailUpload
      ? await directUploads.verify(body.thumbnailUpload, 'THUMBNAIL')
      : undefined;
    const verifiedSubmitterAvatar = body.submitterAvatarUpload
      ? await directUploads.verify(body.submitterAvatarUpload, 'SUBMITTER_AVATAR')
      : undefined;
    const contributors = body.contributors
      ? await Promise.all(
          body.contributors.map(async ({ avatarUpload, ...contributor }) => {
            const verifiedAvatar = avatarUpload
              ? await directUploads.verify(avatarUpload, 'CONTRIBUTOR_AVATAR')
              : undefined;
            return {
              ...contributor,
              avatarUrl: verifiedAvatar ? verifiedAvatar.url : contributor.avatarUrl,
            };
          }),
        )
      : undefined;

    const updated = await projectService.updateContent(c.req.param('id')!, {
      ...body,
      submitterAvatarUrl: verifiedSubmitterAvatar
        ? verifiedSubmitterAvatar.url
        : body.submitterAvatarUrl,
      thumbnail: verifiedThumbnail
        ? {
            url: verifiedThumbnail.url,
            key: verifiedThumbnail.key,
            provider: StorageProvider.CLOUDFLARE_R2,
          }
        : undefined,
      contributors,
    });
    if (updated) {
      const user = c.get('user') as { id: string };
      await audit.record({ actorUserId: user.id, action: 'project.content_updated', resource: 'project', resourceId: updated.id });
    }
    return c.json({ data: updated, message: 'Conteúdo do projeto atualizado.' }, 200);
  }

  private async canManage(c: Context) {
    const user = c.get('user') as { id: string; role: string };
    return projectService.canManageProject(c.req.param('id')!, user.id, user.role);
  }

  async authorizeUploads(c: Context) {
    if (!(await this.canManage(c))) return c.json({ error: 'Forbidden', message: 'You cannot edit this project media.' }, 403);
    const body = await c.req.json<{ files?: Array<{ id?: unknown; kind?: unknown; contentType?: unknown; size?: unknown }> }>();
    const files = (body.files ?? []).map((file) => ({
      id: typeof file.id === 'string' ? file.id : '',
      kind: file.kind as DirectUploadKind,
      contentType: typeof file.contentType === 'string' ? file.contentType : '',
      size: typeof file.size === 'number' ? file.size : NaN,
    }));
    const uploads = await directUploads.authorize(files);
    return c.json({ data: { uploads } }, 201);
  }

  async setCanvaPresentation(c: Context) {
    if (!(await this.canManage(c))) return c.json({ error: 'Forbidden', message: 'You cannot edit this project media.' }, 403);
    const body = await c.req.json<{ url: string }>();
    const presentation = await projectService.setCanvaPresentation(c.req.param('id')!, body.url);
    return c.json({ data: presentation }, 200);
  }

  async uploadThumbnail(c: Context) {
    if (!(await this.canManage(c))) return c.json({ error: 'Forbidden', message: 'You cannot edit this project media.' }, 403);
    const body = await c.req.parseBody();
    const file = body.file as unknown;
    if (!file || typeof file === 'string' || Array.isArray(file) || typeof (file as { arrayBuffer?: unknown }).arrayBuffer !== 'function') return c.json({ error: 'Bad Request', message: 'A thumbnail file is required.' }, 400);
    const mediaFile = file as UploadableMedia;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mediaFile.type)) return c.json({ error: 'Unprocessable Entity', message: 'Thumbnail must be JPEG, PNG or WebP.' }, 422);
    if (mediaFile.size > 2 * 1024 * 1024) return c.json({ error: 'Unprocessable Entity', message: 'Thumbnail must be smaller than 2 MB.' }, 422);
    await assertImageSignature(mediaFile);
    const project = await projectService.uploadThumbnail(c.req.param('id')!, mediaFile);
    return c.json({ data: project }, 200);
  }

  async uploadAvatar(c: Context) {
    if (!(await this.canManage(c))) return c.json({ error: 'Forbidden', message: 'You cannot edit this project media.' }, 403);
    const body = await c.req.parseBody();
    const file = body.file as unknown;
    if (!file || typeof file === 'string' || Array.isArray(file) || typeof (file as { arrayBuffer?: unknown }).arrayBuffer !== 'function') return c.json({ error: 'Bad Request', message: 'An avatar image file is required.' }, 400);
    const mediaFile = file as UploadableMedia;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mediaFile.type)) return c.json({ error: 'Unprocessable Entity', message: 'Avatar must be JPEG, PNG or WebP.' }, 422);
    if (mediaFile.size > 2 * 1024 * 1024) return c.json({ error: 'Unprocessable Entity', message: 'Avatar must be smaller than 2 MB.' }, 422);
    await assertImageSignature(mediaFile);
    const stored = await projectService.uploadAvatar(c.req.param('id')!, mediaFile);
    return c.json({ data: stored }, 200);
  }

  async uploadPdf(c: Context) {
    if (!(await this.canManage(c))) return c.json({ error: 'Forbidden', message: 'You cannot edit this project media.' }, 403);
    const body = await c.req.parseBody();
    const file = body.file as unknown;
    if (!file || typeof file === 'string' || Array.isArray(file) || typeof (file as { arrayBuffer?: unknown }).arrayBuffer !== 'function') return c.json({ error: 'Bad Request', message: 'A PDF file is required.' }, 400);
    const mediaFile = file as UploadableMedia;
    if (mediaFile.type !== 'application/pdf') return c.json({ error: 'Unprocessable Entity', message: 'Presentation must be a PDF.' }, 422);
    if (mediaFile.size > 10 * 1024 * 1024) return c.json({ error: 'Unprocessable Entity', message: 'PDF must be smaller than 10 MB.' }, 422);
    await assertPdfSignature(mediaFile);
    const presentation = await projectService.uploadPdf(c.req.param('id')!, mediaFile);
    return c.json({ data: presentation }, 200);
  }

  async deletePresentation(c: Context) {
    if (!(await this.canManage(c))) return c.json({ error: 'Forbidden', message: 'You cannot edit this project media.' }, 403);
    await projectService.deletePresentation(c.req.param('id')!);
    return c.body(null, 204);
  }
}
