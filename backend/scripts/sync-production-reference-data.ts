// One-off, idempotent sync of reference data that's defined in code
// (permissions, roles/role-permissions, grades) but isn't safe to apply to
// production via the full prisma/seed.ts — that script also seeds starter
// categories by English name ("Dresses", "Sweaters", ...) which would sit
// alongside the real imported catalog's differently-named categories
// ("Dress", "Sweater", ...) as duplicates. This script touches only
// Permission/Role/RolePermission/Grade, all via upsert, so it's safe to
// re-run any time new permissions/roles/grades are added in code.
import { prisma } from "../src/lib/prisma.js";
import { PERMISSIONS, ROLE_PERMISSIONS } from "../src/lib/permissions.js";

async function main() {
  for (const code of PERMISSIONS) {
    await prisma.permission.upsert({ where: { code }, update: {}, create: { code, label: code } });
  }

  for (const [roleCode, permissionCodes] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await prisma.role.upsert({
      where: { code: roleCode },
      update: {},
      create: { code: roleCode, label: roleCode },
    });

    for (const permissionCode of permissionCodes) {
      const permission = await prisma.permission.findUniqueOrThrow({ where: { code: permissionCode } });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }

  const gradeLabels: Record<string, string> = {
    UNGRADED: "Ungraded / Inspection",
    AB: "Mixed Grade A/B",
    ABC: "Mixed Grade A/B/C",
    BC: "Mixed Grade B/C",
    AC: "Mixed Grade A/C",
  };
  for (const code of ["A", "B", "C", "UNGRADED", "AB", "ABC", "BC", "AC"]) {
    await prisma.grade.upsert({
      where: { code },
      update: {},
      create: { code, label: gradeLabels[code] ?? `Grade ${code}` },
    });
  }

  console.log("Reference data synced: permissions, roles/role-permissions, grades.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
