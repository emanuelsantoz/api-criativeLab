import { Hono } from 'hono';
import { InstitutionRole } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../db/prisma';
import { requireAdmin, requireAuth } from '../auth';

export const institutionRoutes = new Hono();

const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use letras minúsculas, números e hífens.').min(2).max(100);
const optionalUrl = z.string().trim().url().max(2048).optional().or(z.literal(''));
const institutionTypeSchema = z.object({ name: z.string().trim().min(2).max(100), slug });
const institutionSchema = z.object({
  name: z.string().trim().min(2).max(160),
  slug,
  institutionTypeId: z.string().uuid(),
  logoUrl: optionalUrl,
  websiteUrl: optionalUrl,
  active: z.boolean().optional(),
});
const updateInstitutionSchema = institutionSchema.omit({ institutionTypeId: true }).partial();
const membershipSchema = z.object({ userId: z.string().uuid(), role: z.nativeEnum(InstitutionRole), active: z.boolean().optional() });

const institutionSelect = {
  id: true,
  name: true,
  slug: true,
  logoUrl: true,
  websiteUrl: true,
  active: true,
  institutionType: { select: { id: true, name: true, slug: true } },
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

institutionRoutes.post('/types', requireAuth, requireAdmin, async (c) => {
  const body = institutionTypeSchema.parse(await c.req.json());
  const type = await prisma.institutionType.create({ data: body });
  return c.json({ data: type, message: 'Tipo de instituição cadastrado.' }, 201);
});

institutionRoutes.post('/', requireAuth, requireAdmin, async (c) => {
  const body = institutionSchema.parse(await c.req.json());
  const institution = await prisma.institution.create({
    data: { ...body, logoUrl: body.logoUrl || null, websiteUrl: body.websiteUrl || null },
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
      ...(body.logoUrl !== undefined ? { logoUrl: body.logoUrl || null } : {}),
      ...(body.websiteUrl !== undefined ? { websiteUrl: body.websiteUrl || null } : {}),
    },
    select: institutionSelect,
  });
  return c.json({ data: institution, message: 'Instituição atualizada.' });
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
