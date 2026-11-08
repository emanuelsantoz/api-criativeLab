import { z } from 'zod';

export const submissionFeedbackSchema = z.object({
  requiredInformationEase: z.enum(['VERY_EASY', 'EASY', 'DIFFICULT', 'VERY_DIFFICULT']),
  overallExperience: z.enum(['PERFECT', 'GOOD', 'BAD', 'VERY_BAD']),
  hardestStep: z.enum([
    'COURSE_CLASS',
    'PROJECT_INFORMATION',
    'TEAM_MEMBERS',
    'MEDIA_UPLOAD',
    'PROJECT_LINKS',
    'NO_DIFFICULTY',
    'OTHER',
  ]),
  hardestStepOther: z.string().trim().min(2).max(160).optional(),
  understoodNextSteps: z.enum(['YES_COMPLETELY', 'YES_PARTIALLY', 'NO']),
  reuseIntent: z.enum(['DEFINITELY', 'PROBABLY', 'MAYBE', 'PROBABLY_NOT', 'WOULD_NOT_USE']),
  improvementSuggestion: z.string().trim().max(1200).optional(),
}).superRefine((data, context) => {
  if (data.hardestStep === 'OTHER' && !data.hardestStepOther) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['hardestStepOther'], message: 'Descreva a outra dificuldade.' });
  }
  if (data.hardestStep !== 'OTHER' && data.hardestStepOther) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['hardestStepOther'], message: 'Este campo só é usado para outra dificuldade.' });
  }
});
