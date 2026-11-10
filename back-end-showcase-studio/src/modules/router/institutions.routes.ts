import { Hono } from 'hono';
import { InstitutionMediaType, InstitutionRole, ProjectStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../db/prisma';
import { requireAdmin, requireAuth } from '../auth';

export const institutionRoutes = new Hono();

const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use letras minúsculas, números e hífens.').min(2).max(100);
const optionalUrl = z.string().trim().url().max(2048).optional().or(z.literal(''));
const optionalText = z.string().trim().max(4_000).optional().or(z.literal(''));
const institutionTypeSchema = z.object({ name: z.string().trim().min(2).max(100), slug });
const institutionSchema = z.object({
  name: z.string().trim().min(2).max(160),
  slug,
  institutionTypeId: z.string().uuid(),
  description: optionalText,
  logoUrl: optionalUrl,
  websiteUrl: optionalUrl,
  active: z.boolean().optional(),
});
const updateInstitutionSchema = institutionSchema.omit({ institutionTypeId: true }).partial();
const membershipSchema = z.object({ userId: z.string().uuid(), role: z.nativeEnum(InstitutionRole), active: z.boolean().optional() });
const mediaSchema = z.object({
  type: z.nativeEnum(InstitutionMediaType),
  url: z.string().trim().url().max(2048),
  altText: z.string().trim().max(220).optional().or(z.literal('')),
  caption: z.string().trim().max(500).optional().or(z.literal('')),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});

const institutionSelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
  logoUrl: true,
  websiteUrl: true,
  active: true,
  institutionType: { select: { id: true, name: true, slug: true } },
  media: {
    select: { id: true, type: true, url: true, altText: true, caption: true, sortOrder: true },
    orderBy: { sortOrder: 'asc' },
  },
} as const;

institutionRoutes.get('/', async (c) => {
  const institutions = await prisma.institution.findMany({
    where: { active: true },
    select: institutionSelect,
    orderBy: { name: 'asc' },
  });
  return c.json({ data: institutions });
});

institutionRoutes.get('/types', async (c) => {
  const types = await prisma.institutionType.findMany({ select: { id: true, name: true, slug: true }, orderBy: { name: 'asc' } });
  return c.json({ data: types });
});

institutionRoutes.get('/mine', requireAuth, async (c) => {
  const user = (c as any).get('user') as { id: string };
  const memberships = await prisma.institutionMembership.findMany({
    where: { userId: user.id, active: true, institution: { active: true } },
    select: { role: true, institution: { select: institutionSelect } },
    orderBy: { institution: { name: 'asc' } },
  });
  return c.json({ data: memberships });
});

institutionRoutes.get('/admin', requireAuth, requireAdmin, async (c) => {
  const institutions = await prisma.institution.findMany({
    select: { ...institutionSelect, _count: { select: { memberships: true, courses: true, submissionContexts: true } } },
    orderBy: { name: 'asc' },
  });
  return c.json({ data: institutions });
});

// Perfil público. O slug é estável para URLs compartilháveis e não expõe
// membros, permissões ou outros dados administrativos da instituição.
institutionRoutes.get('/:slug', async (c) => {
  const parsedSlug = slug.safeParse(c.req.param('slug'));
  if (!parsedSlug.success) return c.json({ error: 'Not Found', message: 'Instituição não encontrada.' }, 404);

  const institution = await prisma.institution.findFirst({
    where: { slug: parsedSlug.data, active: true },
    select: institutionSelect,
  });
  if (!institution) return c.json({ error: 'Not Found', message: 'Instituição não encontrada.' }, 404);

  const projectsCount = await prisma.project.count({
    where: { status: ProjectStatus.APPROVED, course: { institutionId: institution.id } },
  });
  return c.json({ data: { ...institution, projectsCount } });
});

institutionRoutes.post('/types', requireAuth, requireAdmin, async (c) => {
  const body = institutionTypeSchema.parse(await c.req.json());
  const type = await prisma.institutionType.create({ data: body });
  return c.json({ data: type, message: 'Tipo de instituição cadastrado.' }, 201);
});

institutionRoutes.post('/', requireAuth, requireAdmin, async (c) => {
  const body = institutionSchema.parse(await c.req.json());
  const institution = await prisma.institution.create({
    data: { ...body, description: body.description || null, logoUrl: body.logoUrl || null, websiteUrl: body.websiteUrl || null },
    select: institutionSelect,
  });
  return c.json({ data: institution, message: 'Instituição cadastrada.' }, 201);
});

institutionRoutes.patch('/:id', requireAuth, requireAdmin, async (c) => {
  const body = updateInstitutionSchema.parse(await c.req.json());
  const institution = await prisma.institution.update({
    where: { id: c.req.param('id') },
    data: {
      ...body,
      ...(body.description !== undefined ? { description: body.description || null } : {}),
      ...(body.logoUrl !== undefined ? { logoUrl: body.logoUrl || null } : {}),
      ...(body.websiteUrl !== undefined ? { websiteUrl: body.websiteUrl || null } : {}),
    },
    select: institutionSelect,
  });
  return c.json({ data: institution, message: 'Instituição atualizada.' });
});

institutionRoutes.post('/:id/media', requireAuth, requireAdmin, async (c) => {
  const body = mediaSchema.parse(await c.req.json());
  const media = await prisma.institutionMedia.create({
    data: {
      institutionId: c.req.param('id'),
      type: body.type,
      url: body.url,
      altText: body.altText || null,
      caption: body.caption || null,
      sortOrder: body.sortOrder ?? 0,
    },
  });
  return c.json({ data: media, message: 'Mídia institucional adicionada.' }, 201);
});

institutionRoutes.patch('/:id/media/:mediaId', requireAuth, requireAdmin, async (c) => {
  const body = mediaSchema.partial().parse(await c.req.json());
  const media = await prisma.institutionMedia.updateMany({
    where: { id: c.req.param('mediaId'), institutionId: c.req.param('id') },
    data: {
      ...body,
      ...(body.altText !== undefined ? { altText: body.altText || null } : {}),
      ...(body.caption !== undefined ? { caption: body.caption || null } : {}),
    },
  });
  if (media.count === 0) return c.json({ error: 'Not Found', message: 'Mídia não encontrada.' }, 404);
  return c.json({ message: 'Mídia institucional atualizada.' });
});

institutionRoutes.delete('/:id/media/:mediaId', requireAuth, requireAdmin, async (c) => {
  const media = await prisma.institutionMedia.deleteMany({ where: { id: c.req.param('mediaId'), institutionId: c.req.param('id') } });
  if (media.count === 0) return c.json({ error: 'Not Found', message: 'Mídia não encontrada.' }, 404);
  return c.body(null, 204);
});

institutionRoutes.get('/:id/members', requireAuth, requireAdmin, async (c) => {
  const members = await prisma.institutionMembership.findMany({
    where: { institutionId: c.req.param('id') },
    select: { role: true, active: true, createdAt: true, user: { select: { id: true, name: true, email: true, role: true } } },
    orderBy: { user: { name: 'asc' } },
  });
  return c.json({ data: members });
});

institutionRoutes.put('/:id/members/:userId', requireAuth, requireAdmin, async (c) => {
  const body = membershipSchema.omit({ userId: true }).parse(await c.req.json());
  const institutionId = c.req.param('id')!;
  const userId = c.req.param('userId')!;
  const membership = await prisma.institutionMembership.upsert({
    where: { institutionId_userId: { institutionId, userId } },
    create: { institutionId, userId, role: body.role, active: body.active ?? true },
    update: { role: body.role, ...(body.active !== undefined ? { active: body.active } : {}) },
    select: { role: true, active: true, institution: { select: institutionSelect }, user: { select: { id: true, name: true, email: true } } },
  });
  return c.json({ data: membership, message: 'Vínculo institucional salvo.' });
});
