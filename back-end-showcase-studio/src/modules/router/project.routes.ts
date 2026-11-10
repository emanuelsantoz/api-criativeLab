import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { ProjectController } from '../controllers/project.controller';
import { canvaPresentationSchema, createProjectSchema, engagementSchema, queryProjectSchema, updateProjectContentSchema, updateProjectStatusSchema } from '../schemas/project.schema';
import { requireAuth, requireModerator } from '../auth';
import { enforceContentLength, enforceRateLimit } from '../security/rate-limit';

const router = new Hono();
const controller = new ProjectController();

// Rotas Públicas
router.get('/', zValidator('query', queryProjectSchema, (result, c) => {
  if (!result.success) {
    return c.json({ error: 'Invalid query parameters', details: result.error }, 400);
  }
}), controller.getAll);
router.get('/stats', controller.getPublicStats);
router.get('/:id', controller.getById);
router.patch('/:id/view', enforceRateLimit({ scope: 'project-view', limit: 60, windowMs: 60_000 }), zValidator('json', engagementSchema), controller.incrementViews);

// Rotas de Projeto (criação, like, moderação) 
// Refatorar para caso queira dar like -> ter autenticação
router.post('/', requireAuth, zValidator('json', createProjectSchema), controller.create);
router.post('/:id/like', enforceRateLimit({ scope: 'project-like', limit: 30, windowMs: 60_000 }), zValidator('json', engagementSchema), controller.handleLike);
router.patch('/:id/status', requireAuth, requireModerator, zValidator('json', updateProjectStatusSchema), controller.moderate);
router.delete('/:id', requireAuth, requireModerator, controller.remove);
router.patch('/:id/content', requireAuth, zValidator('json', updateProjectContentSchema), controller.updateContent);
router.post('/:id/uploads/authorize', requireAuth, enforceRateLimit({ scope: 'project-upload-authorize', limit: 40, windowMs: 60 * 60_000 }), controller.authorizeUploads);
router.post('/:id/thumbnail', requireAuth, enforceRateLimit({ scope: 'project-thumbnail', limit: 30, windowMs: 60 * 60_000 }), enforceContentLength(3 * 1024 * 1024), controller.uploadThumbnail);
router.post('/:id/avatar', requireAuth, enforceRateLimit({ scope: 'project-avatar', limit: 60, windowMs: 60 * 60_000 }), enforceContentLength(3 * 1024 * 1024), controller.uploadAvatar);
router.post('/:id/presentation/canva', requireAuth, zValidator('json', canvaPresentationSchema), controller.setCanvaPresentation);
router.post('/:id/presentation/pdf', requireAuth, enforceRateLimit({ scope: 'project-pdf', limit: 8, windowMs: 60 * 60_000 }), enforceContentLength(11 * 1024 * 1024), controller.uploadPdf);
router.delete('/:id/presentation', requireAuth, controller.deletePresentation);

export const projectRoutes = router;
