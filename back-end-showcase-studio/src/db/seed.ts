import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { InstitutionRole, PrismaClient, Role, SubmissionContextStatus, SubmissionScope } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Seed inicial do ambiente real de testes.
 *
 * Este seed é destrutivo por design: remove todos os dados de domínio e recria
 * somente o professor de teste. A confirmação explícita evita uma execução
 * acidental contra um banco de produção.
 */
async function main() {
  if (process.env.SEED_RESET_CONFIRMATION !== 'RESET') {
    throw new Error('Para zerar o banco, defina SEED_RESET_CONFIRMATION=RESET.');
  }

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'emanuelsantossouzajesus@gmail.com';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminPassword) {
    throw new Error('Defina SEED_ADMIN_PASSWORD com a senha do administrador antes de executar o seed.');
  }
  const adminPasswordHash = await bcrypt.hash(adminPassword, 12);
  const professorPasswordHash = await bcrypt.hash('123456_temporial', 12);
  const initialTags = ['React', 'TypeScript', 'Node.js', 'Python', 'IA', 'Machine Learning', 'IoT', 'Mobile', 'UI/UX', 'Banco de Dados', 'Cloud', 'DevOps', 'Blockchain', 'AR/VR', 'Sustentabilidade', 'Educação', 'Saúde', 'Cidades Inteligentes'];

  await prisma.$transaction(async (tx) => {
    await tx.like.deleteMany();
    await tx.projectMember.deleteMany();
    await tx.projectContributor.deleteMany();
    await tx.projectReview.deleteMany();
    await tx.projectAccessToken.deleteMany();
    await tx.projectPresentation.deleteMany();
    await tx.project.deleteMany();
    await tx.submissionContextTag.deleteMany();
    await tx.submissionContext.deleteMany();
    await tx.courseDiscipline.deleteMany();
    await tx.discipline.deleteMany();
    await tx.academicPeriod.deleteMany();
    await tx.semesterCourse.deleteMany();
    await tx.tag.deleteMany();
    await tx.course.deleteMany();
    await tx.semester.deleteMany();
    await tx.institutionMembership.deleteMany();
    await tx.institution.deleteMany();
    await tx.institutionType.deleteMany();
    await tx.user.deleteMany();

    const professor = await tx.user.create({
      data: {
        name: 'Administrador da Plataforma',
        email: adminEmail.toLowerCase(),
        password: adminPasswordHash,
        role: Role.ADMIN,
      },
    });

    const testProfessor = await tx.user.create({
      data: {
        name: 'Professor de Teste',
        email: 'professor_teste@gmail.com',
        password: professorPasswordHash,
        role: Role.COORDENADOR,
      },
    });

    const institutionType = await tx.institutionType.create({ data: { name: 'Faculdade de Tecnologia', slug: 'faculdade-de-tecnologia' } });
    const institution = await tx.institution.create({
      data: {
        name: 'Fatec Jahu',
        slug: 'fatec-jahu',
        institutionTypeId: institutionType.id,
        websiteUrl: 'https://fatecjahu.edu.br',
      },
    });
    await tx.institutionMembership.createMany({
      data: [
        { institutionId: institution.id, userId: professor.id, role: InstitutionRole.INSTITUTION_ADMIN },
        { institutionId: institution.id, userId: testProfessor.id, role: InstitutionRole.PROFESSOR },
      ],
    });
    const course = await tx.course.create({ data: { institutionId: institution.id, name: 'Gestão de TI', description: 'Curso de gestão e tecnologia da informação.' } });
    await tx.user.update({ where: { id: professor.id }, data: { courseId: course.id } });
    await tx.semester.create({ data: { year: 2026, number: 1, code: '2026.1', label: '1º semestre de 2026', startsAt: new Date('2026-02-01T00:00:00.000Z'), endsAt: new Date('2026-07-31T23:59:59.000Z'), status: 'CLOSED' } });
    const semester = await tx.semester.create({ data: { year: 2026, number: 2, code: '2026.2', label: '2º semestre de 2026', startsAt: new Date('2026-08-01T00:00:00.000Z'), endsAt: new Date('2026-12-31T23:59:59.000Z'), status: 'OPEN' } });
    const tags = await Promise.all(initialTags.map((name) => tx.tag.create({ data: { name } })));
    const semesterCourse = await tx.semesterCourse.create({ data: { semesterId: semester.id, courseId: course.id, className: 'Gestão de TI - S1', theme: 'Tecnologia aplicada à IA' } });
    await tx.semesterCourseTag.createMany({ data: tags.map((tag) => ({ semesterId: semesterCourse.semesterId, courseId: semesterCourse.courseId, className: semesterCourse.className, tagId: tag.id })) });
    const academicPeriod = await tx.academicPeriod.create({
      data: { institutionId: institution.id, code: semester.code, label: semester.label, startsAt: semester.startsAt, endsAt: semester.endsAt },
    });
    const submissionContext = await tx.submissionContext.create({
      data: {
        institutionId: institution.id,
        academicPeriodId: academicPeriod.id,
        courseId: course.id,
        scope: SubmissionScope.COURSE,
        status: SubmissionContextStatus.OPEN,
        name: 'Mostra de projetos GTI',
        className: semesterCourse.className,
        theme: semesterCourse.theme,
        submissionsOpenAt: semester.startsAt,
        submissionsCloseAt: semester.endsAt,
      },
    });
    await tx.submissionContextTag.createMany({ data: tags.map((tag) => ({ submissionContextId: submissionContext.id, tagId: tag.id })) });
    await tx.project.create({
      data: {
        slug: 'rotas-inteligentes',
        title: 'Rotas Inteligentes',
        shortDescription: 'Projeto demonstrativo inicial do portfólio acadêmico.',
        description: 'Projeto inicial para validar o fluxo de publicação, semestre, disciplina, turma e tags.',
        courseId: course.id,
        className: semesterCourse.className,
        semesterId: semester.id,
        submissionContextId: submissionContext.id,
        createdById: professor.id,
        submitterName: professor.name,
        submitterEmail: professor.email,
        status: 'APPROVED',
        tags: ['IA', 'React', 'TypeScript'],
        liveUrl: 'https://example.com',
      },
    });
  }, { maxWait: 10_000, timeout: 60_000 });

  console.log('Banco resetado com sucesso.');
  console.log(`Administrador criado: ${adminEmail}`);
  console.log('Professor criado: professor_teste@gmail.com');
  console.log('Senha temporária: 123456_temporial');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
