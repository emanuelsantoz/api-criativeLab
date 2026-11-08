import type { Context } from 'hono';
import crypto from 'node:crypto';
import { z } from 'zod';
import { SubmissionOrchestrator, type DirectPublicSubmissionInput, type PublicSubmissionInput } from '../orchestrators/submission.orchestrator';
import { AccessTokenService } from '../services/access-token.service';
import { publicResubmissionSchema, publicSubmissionSchema } from '../schemas/submission.schema';
import { submissionFeedbackSchema } from '../schemas/submission-feedback.schema';
import type { UploadableMedia } from '../storage/media.storage';
import { assertImageSignature, assertPdfSignature } from '../storage/media-validation';
import { DirectUploadService, type DirectUploadKind, type DirectUploadReference } from '../storage/direct-upload.service';
import { AuditService } from '../services/audit.service';
import { prisma } from '../../db/prisma';

const orchestrator = new SubmissionOrchestrator();
const accessTokens = new AccessTokenService();
const directUploads = new DirectUploadService();
const audit = new AuditService();
const MAX_TOTAL_SUBMISSION_MEDIA_BYTES = 20 * 1024 * 1024;
type PublicMetadata = Omit<PublicSubmissionInput, 'thumbnail' | 'presentation'>;
type ResubmissionMetadata = Omit<PublicMetadata, 'courseId' | 'className' | 'membersIds' | 'submitterName' | 'submitterEmail'>;

export class SubmissionController {
  async create(c: Context) {
    if (c.req.header('content-type')?.includes('application/json')) {
      const input = await parseDirectSubmissionBody(await c.req.json<Record<string, unknown>>());
      const result = await orchestrator.submitDirect(input);
      await audit.record({ action: 'public-submission-created', resource: 'project', resourceId: result.project.id, metadata: { uploadFlow: 'direct-r2' } })
        .catch((error) => console.error('[Audit] public submission record failed', { error: error instanceof Error ? error.message : String(error) }));
      console.info('[PublicSubmission] persisted direct upload submission', { projectId: result.project.id });
      return c.json({ data: result.project, accessToken: result.accessToken, accessExpiresAt: result.accessExpiresAt }, 201);
    }
    const body = await c.req.parseBody();
    const input = await parseSubmissionBody(body as Record<string, unknown>);
    const result = await orchestrator.submit(input);
    console.info('[PublicSubmission] persisted multipart submission', { projectId: result.project.id });
    return c.json({ data: result.project, accessToken: result.accessToken, accessExpiresAt: result.accessExpiresAt }, 201);
  }

  async authorizeUploads(c: Context) {
    const body = await c.req.json<{ files?: Array<{ id?: unknown; kind?: unknown; contentType?: unknown; size?: unknown }> }>();
    const files = (body.files ?? []).map((file) => ({
      id: typeof file.id === 'string' ? file.id : '',
      kind: file.kind as DirectUploadKind,
      contentType: typeof file.contentType === 'string' ? file.contentType : '',
      size: typeof file.size === 'number' ? file.size : NaN,
    }));
    const uploads = await directUploads.authorize(files);
    await audit.record({ action: 'public-upload-authorized', resource: 'media-upload', resourceId: crypto.randomUUID(), metadata: { count: uploads.length } })
      .catch((error) => console.error('[Audit] upload authorization record failed', { error: error instanceof Error ? error.message : String(error) }));
    console.info('[PublicSubmission] authorized direct uploads', { count: uploads.length });
    return c.json({ data: { uploads } }, 201);
  }

  async access(c: Context) {
    const body = await c.req.json<{ projectId: string; token: string }>();
    const access = await accessTokens.findValid(body.token, body.projectId);
    if (!access) return c.json({ error: 'Unauthorized', message: 'Submission access token is invalid or expired.' }, 401);
    return c.json({ data: access.project, accessToken: body.token, expiresAt: access.expiresAt }, 200);
  }

  async get(c: Context) {
    const access = c.get('submissionAccess') as { project: unknown };
    return c.json({ data: access.project }, 200);
  }

  async update(c: Context) {
    const access = c.get('submissionAccess') as { projectId: string };
    const body = await c.req.parseBody();
    const input = await parseResubmissionBody(body as Record<string, unknown>);
    const project = await orchestrator.resubmit(access.projectId, input, (c.get('submissionAccess') as { token: string }).token);
    return c.json({ data: project, message: 'Projeto atualizado. Reenvie para validação.' }, 200);
  }

  async resubmit(c: Context) {
    const access = c.get('submissionAccess') as { projectId: string; token: string };
    const project = await orchestrator.resubmit(access.projectId, await parseResubmissionBody(await c.req.parseBody() as Record<string, unknown>), access.token);
    return c.json({ data: project, message: 'Projeto reenviado para validação.' }, 200);
  }

  async feedback(c: Context) {
    const input = submissionFeedbackSchema.parse(await c.req.json());
    const access = c.get('submissionAccess') as { projectId: string };
    const feedback = await prisma.submissionFeedback.create({
      data: {
        projectId: access.projectId,
        ...input,
        hardestStepOther: input.hardestStepOther || null,
        improvementSuggestion: input.improvementSuggestion || null,
      },
      select: { id: true, createdAt: true },
    });
    await audit.record({
      action: 'submission-feedback-created',
      resource: 'project',
      resourceId: access.projectId,
      metadata: { overallExperience: input.overallExperience, reuseIntent: input.reuseIntent },
    }).catch((error) => console.error('[Audit] submission feedback record failed', { error: error instanceof Error ? error.message : String(error) }));
    return c.json({ data: feedback }, 201);
  }
}

async function parseDirectSubmissionBody(body: Record<string, unknown>): Promise<DirectPublicSubmissionInput> {
  const metadata = parseMetadata(body, true);
  const thumbnail = await verifyUpload(body.thumbnailUpload, 'THUMBNAIL');
  const submitterAvatar = body.submitterAvatarUpload ? await verifyUpload(body.submitterAvatarUpload, 'SUBMITTER_AVATAR') : undefined;
  const rawContributors = Array.isArray(body.contributors) ? body.contributors : [];
  const contributors = await Promise.all(metadata.contributors.map(async (contributor, index) => {
    const raw = rawContributors[index];
    const avatarUpload = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).avatarUpload : undefined;
    return {
      ...contributor,
      avatar: avatarUpload ? await verifyUpload(avatarUpload, 'CONTRIBUTOR_AVATAR') : undefined,
    };
  }));
  const presentation = await parseDirectPresentation(body);
  return { ...metadata, thumbnail, submitterAvatar, contributors, presentation };
}

async function parseDirectPresentation(body: Record<string, unknown>): Promise<DirectPublicSubmissionInput['presentation']> {
  if (body.presentationType === 'PDF') return { type: 'PDF', file: await verifyUpload(body.presentationUpload, 'PRESENTATION_PDF') };
  if (body.presentationType === 'CANVA') {
    const url = String(body.canvaUrl ?? '');
    if (!/^https?:\/\/(www\.)?canva\.com\/design\/.+\/view/i.test(url)) throw new Error('URL pública do Canva inválida.');
    return { type: 'CANVA', url };
  }
  if (body.presentationType === 'POWERPOINT') {
    const url = String(body.powerpointUrl ?? '');
    if (!/^https?:\/\/(www\.)?1drv\.ms\/p\/.+/i.test(url)) throw new Error('URL de incorporação do PowerPoint inválida.');
    return { type: 'POWERPOINT', url };
  }
  throw new Error('Tipo de apresentação inválido.');
}

async function verifyUpload(value: unknown, kind: DirectUploadKind) {
  if (!value || typeof value !== 'object') throw new Error('Arquivo obrigatório não enviado.');
  const reference = value as DirectUploadReference;
  return directUploads.verify(reference, kind);
}

async function parseSubmissionBody(body: Record<string, unknown>): Promise<PublicSubmissionInput> {
  const metadata = parseMetadata(body, true);
  const contributors = metadata.contributors.map((contributor, index) => ({
    ...contributor,
    avatarFile: getOptionalFile(body[`contributorAvatar_${index}`]),
  }));
  await Promise.all(contributors.map(({ avatarFile }) => avatarFile ? validateAvatar(avatarFile) : undefined));
  const submitterAvatarFile = getOptionalFile(body.submitterAvatar);
  if (submitterAvatarFile) await validateAvatar(submitterAvatarFile);
  const thumbnail = getFile(body.thumbnail);
  await validateThumbnail(thumbnail);
  const presentation = await parsePresentation(body);
  assertTotalMediaSize([thumbnail, submitterAvatarFile, ...contributors.map((contributor) => contributor.avatarFile), presentation.type === 'PDF' ? presentation.file : undefined]);
  return { ...metadata, contributors, submitterAvatarFile, thumbnail, presentation };
}

async function parseResubmissionBody(body: Record<string, unknown>): Promise<Omit<PublicSubmissionInput, 'courseId' | 'className' | 'membersIds' | 'submitterName' | 'submitterEmail'>> {
  const metadata = parseMetadata(body, false);
  const thumbnail = getFile(body.thumbnail);
  await validateThumbnail(thumbnail);
  const presentation = await parsePresentation(body);
  assertTotalMediaSize([thumbnail, presentation.type === 'PDF' ? presentation.file : undefined]);
  return { ...metadata, thumbnail, presentation };
}

function parseMetadata(body: Record<string, unknown>, identity: true): PublicMetadata;
function parseMetadata(body: Record<string, unknown>, identity: false): ResubmissionMetadata;
function parseMetadata(body: Record<string, unknown>, identity: boolean): PublicMetadata | ResubmissionMetadata {
  const rawMembers = typeof body.membersIds === 'string' ? parseJson(body.membersIds, []) : body.membersIds;
  const rawContributors = typeof body.contributors === 'string' ? parseJson(body.contributors, []) : body.contributors;
  const rawTags = typeof body.tags === 'string' ? parseJson(body.tags, []) : body.tags;
  const schema = identity ? publicSubmissionSchema : publicResubmissionSchema;
  const result = schema.safeParse({
    title: body.title,
    shortDescription: body.shortDescription,
    description: body.description,
    ...(identity ? { courseId: body.courseId, className: body.className, submitterName: body.submitterName, submitterEmail: body.submitterEmail, membersIds: rawMembers } : {}),
    contributors: rawContributors,
    tags: rawTags,
    liveUrl: optionalString(body.liveUrl),
    prototypeUrl: optionalString(body.prototypeUrl),
    repositoryUrl: optionalString(body.repositoryUrl),
    presentationType: body.presentationType,
    canvaUrl: body.canvaUrl,
    powerpointUrl: body.powerpointUrl,
  });
  if (!result.success) throw new z.ZodError(result.error.issues);
  const data = result.data as z.infer<typeof publicSubmissionSchema>;
  const common: ResubmissionMetadata = {
    title: data.title,
    shortDescription: data.shortDescription,
    description: data.description,
    contributors: data.contributors,
    tags: data.tags,
    liveUrl: data.liveUrl,
    prototypeUrl: data.prototypeUrl,
    repositoryUrl: data.repositoryUrl,
  };
  if (!identity) return common;
  return {
    ...common,
    courseId: data.courseId,
    className: data.className,
    membersIds: data.membersIds,
    submitterName: data.submitterName,
    submitterEmail: data.submitterEmail,
  };
}

async function parsePresentation(body: Record<string, unknown>): Promise<PublicSubmissionInput['presentation']> {
  if (body.presentationType === 'CANVA') {
    const url = String(body.canvaUrl ?? '');
    if (!/^https?:\/\/(www\.)?canva\.com\/design\/.+\/view/i.test(url)) throw new Error('URL pública do Canva inválida.');
    return { type: 'CANVA', url };
  }
  if (body.presentationType === 'POWERPOINT') {
    const url = String(body.powerpointUrl ?? '');
    if (!/^https?:\/\/(www\.)?1drv\.ms\/p\/.+/i.test(url)) throw new Error('URL de incorporaÃ§Ã£o do PowerPoint invÃ¡lida.');
    return { type: 'POWERPOINT', url };
  }
  const file = getFile(body.presentation);
  if (file.type !== 'application/pdf') throw new Error('A apresentação deve ser um PDF.');
  if (file.size > 10 * 1024 * 1024) throw new Error('O PDF deve ter no máximo 10 MB.');
  await assertPdfSignature(file);
  return { type: 'PDF', file };
}

function getFile(value: unknown) {
  if (!value || typeof value === 'string' || Array.isArray(value) || typeof (value as { arrayBuffer?: unknown }).arrayBuffer !== 'function') {
    throw new Error('Arquivo obrigatório não enviado.');
  }
  return value as UploadableMedia;
}

function getOptionalFile(value: unknown) {
  if (!value || typeof value === 'string' || Array.isArray(value) || typeof (value as { arrayBuffer?: unknown }).arrayBuffer !== 'function') return undefined;
  return value as UploadableMedia;
}

async function validateThumbnail(file: UploadableMedia) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('A thumbnail deve ser JPEG, PNG ou WEBP.');
  if (file.size > 2 * 1024 * 1024) throw new Error('A thumbnail deve ter no máximo 2 MB.');
  await assertImageSignature(file);
}

async function validateAvatar(file: UploadableMedia) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('A foto do integrante deve ser JPEG, PNG ou WEBP.');
  if (file.size > 2 * 1024 * 1024) throw new Error('A foto do integrante deve ter no mÃ¡ximo 2 MB.');
  await assertImageSignature(file);
}

function parseJson(value: string, fallback: unknown) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function optionalString(value: unknown) {
  const stringValue = typeof value === 'string' ? value.trim() : '';
  return stringValue || undefined;
}

function assertTotalMediaSize(files: Array<UploadableMedia | undefined>) {
  const total = files.reduce((sum, file) => sum + (file?.size ?? 0), 0);
  if (total > MAX_TOTAL_SUBMISSION_MEDIA_BYTES) {
    throw new Error('O total de arquivos da submissão deve ter no máximo 20 MB.');
  }
}
