import { Hono } from 'hono';
import { requireSubmissionAccess } from '../submission-access';
import { SubmissionController } from '../controllers/submission.controller';
import { enforceContentLength, enforceRateLimit } from '../security/rate-limit';

const router = new Hono();
const controller = new SubmissionController();

router.post('/', enforceRateLimit({ scope: 'public-submission', limit: 3, windowMs: 60 * 60_000 }), enforceContentLength(21 * 1024 * 1024), controller.create);
// Esta rota recebe somente metadados e devolve permissões temporárias para o R2.
// Os binários nunca passam pela Function.
router.post('/uploads/authorize', enforceRateLimit({ scope: 'public-upload-authorize', limit: 12, windowMs: 60 * 60_000 }), controller.authorizeUploads);
router.post('/access', enforceRateLimit({ scope: 'submission-access', limit: 12, windowMs: 15 * 60_000 }), controller.access);
router.post('/:id/feedback', enforceRateLimit({ scope: 'submission-feedback', limit: 5, windowMs: 24 * 60 * 60_000 }), requireSubmissionAccess, controller.feedback);
router.get('/:id', enforceRateLimit({ scope: 'submission-read', limit: 30, windowMs: 15 * 60_000 }), requireSubmissionAccess, controller.get);
router.post('/:id/resubmit', enforceRateLimit({ scope: 'submission-resubmit', limit: 8, windowMs: 60 * 60_000 }), requireSubmissionAccess, controller.resubmit);

export const publicSubmissionRoutes = router;
