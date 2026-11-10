import 'dotenv/config';
import { InstitutionRole, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Migração de dados não destrutiva para o catálogo já publicado.
 *
 * A migration de schema anterior criou a "instituicao-padrao" para manter os
 * registros legados válidos. Este script somente a troca pela Fatec Jahu após
 * confirmação explícita de que TODOS os registros do ambiente pertencem a ela.
 * Nunca use src/db/seed.ts para esse propósito: aquele seed apaga o catálogo.
 */
async function main() {
  if (process.env.INSTITUTION_BACKFILL_CONFIRMATION !== 'APPLY') {
    throw new Error('Execução bloqueada. Defina INSTITUTION_BACKFILL_CONFIRMATION=APPLY após conferir os dados do ambiente.');
  }
  if (process.env.MIGRATE_ALL_COURSES_TO_FATEC !== 'true') {
    throw new Error('Execução bloqueada. Confirme que todos os cursos legados são da Fatec definindo MIGRATE_ALL_COURSES_TO_FATEC=true.');
  }

  const result = await prisma.$transaction(async (tx) => {
    const type = await tx.institutionType.upsert({
      where: { slug: 'faculdade-de-tecnologia' },
      update: { name: 'Faculdade de Tecnologia' },
      create: { name: 'Faculdade de Tecnologia', slug: 'faculdade-de-tecnologia' },
    });
    const fatec = await tx.institution.upsert({
      where: { slug: 'fatec-jahu' },
      update: { institutionTypeId: type.id, active: true },
      create: {
        name: 'Fatec Jahu',
        slug: 'fatec-jahu',
        institutionTypeId: type.id,
        websiteUrl: 'https://fatecjahu.edu.br',
        active: true,
      },
    });
    const legacy = await tx.institution.findUnique({ where: { slug: 'instituicao-padrao' } });
    if (!legacy || legacy.id === fatec.id) return { fatecId: fatec.id, migrated: false };

    const memberships = await tx.institutionMembership.findMany({ where: { institutionId: legacy.id } });
    for (const membership of memberships) {
      await tx.institutionMembership.upsert({
        where: { institutionId_userId: { institutionId: fatec.id, userId: membership.userId } },
        update: { role: membership.role, active: membership.active },
        create: { institutionId: fatec.id, userId: membership.userId, role: membership.role as InstitutionRole, active: membership.active },
      });
    }
    await tx.institutionMembership.deleteMany({ where: { institutionId: legacy.id } });

    const [courses, periods, disciplines, contexts] = await Promise.all([
      tx.course.updateMany({ where: { institutionId: legacy.id }, data: { institutionId: fatec.id } }),
      tx.academicPeriod.updateMany({ where: { institutionId: legacy.id }, data: { institutionId: fatec.id } }),
      tx.discipline.updateMany({ where: { institutionId: legacy.id }, data: { institutionId: fatec.id } }),
      tx.submissionContext.updateMany({ where: { institutionId: legacy.id }, data: { institutionId: fatec.id } }),
    ]);
    await tx.institution.update({ where: { id: legacy.id }, data: { active: false } });
    return { fatecId: fatec.id, migrated: true, courses: courses.count, periods: periods.count, disciplines: disciplines.count, contexts: contexts.count };
  }, { timeout: 30_000 });

  console.log(JSON.stringify({ operation: 'institution-backfill', ...result }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
