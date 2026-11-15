/**
 * One-time correction: SO-0001 and SO-0003's order lines were entered with
 * a grade requirement (ABC and A respectively) that doesn't match any real
 * stock ever received for BAGS-0004 — the only stock that exists for this
 * product is grade AB. The owner confirmed these were data-entry mistakes,
 * not genuinely sold-out grades: both orders should have required AB.
 *
 * Replaces each line's allowedGradeIds with [AB] (not amendGradeRequirement,
 * which only ever adds a grade to the set — these need a correction, not an
 * addition) and logs an AuditEvent with the reason.
 *
 * Usage: DATABASE_URL=... npx tsx scripts/correct-so1-so3-grade-requirement.ts
 */
import { prisma } from "../src/lib/prisma.js";

async function main() {
  const ownerEmail = process.env.SEED_OWNER_EMAIL ?? "owner@example.com";
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } });
  const ab = await prisma.grade.findUniqueOrThrow({ where: { code: "AB" } });

  for (const orderNumber of ["SO-0001", "SO-0003"]) {
    const order = await prisma.salesOrder.findUniqueOrThrow({ where: { orderNumber }, include: { lines: true } });
    for (const line of order.lines) {
      if (line.gradeRequirementType !== "allowed_set") {
        console.log(`${orderNumber} line ${line.id}: not allowed_set, skipping`);
        continue;
      }
      if (line.allowedGradeIds.length === 1 && line.allowedGradeIds[0] === ab.id) {
        console.log(`${orderNumber} line ${line.id}: already AB, skipping`);
        continue;
      }
      const before = line.allowedGradeIds;
      await prisma.salesOrderLine.update({ where: { id: line.id }, data: { allowedGradeIds: [ab.id] } });
      await prisma.auditEvent.create({
        data: {
          actorUserId: owner.id,
          action: "correct_grade_requirement",
          entityType: "SalesOrderLine",
          entityId: line.id,
          beforeJson: { allowedGradeIds: before },
          afterJson: { allowedGradeIds: [ab.id] },
          reason: "Data-entry correction: original grade requirement didn't match any stock ever received for this product; owner confirmed it should have been AB.",
        },
      });
      console.log(`${orderNumber} line ${line.id}: corrected allowedGradeIds ${JSON.stringify(before)} -> ["${ab.id}"] (AB)`);
    }
  }
  console.log("\nDone.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
