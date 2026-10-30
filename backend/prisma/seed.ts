import argon2 from "argon2";
import { prisma } from "../src/lib/prisma.js";
import { PERMISSIONS, ROLE_PERMISSIONS } from "../src/lib/permissions.js";

async function main() {
  for (const code of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code },
      update: {},
      create: { code, label: code },
    });
  }

  for (const [roleCode, permissionCodes] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await prisma.role.upsert({
      where: { code: roleCode },
      update: {},
      create: { code: roleCode, label: roleCode },
    });

    for (const permissionCode of permissionCodes) {
      const permission = await prisma.permission.findUniqueOrThrow({
        where: { code: permissionCode },
      });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }

  for (const code of ["PKR", "GBP", "USD"]) {
    await prisma.currency.upsert({
      where: { code },
      update: {},
      create: { code, symbol: code === "PKR" ? "Rs" : code === "GBP" ? "£" : "$" },
    });
  }

  for (const code of ["A", "B", "C", "UNGRADED"]) {
    await prisma.grade.upsert({
      where: { code },
      update: {},
      create: { code, label: code === "UNGRADED" ? "Ungraded / Inspection" : `Grade ${code}` },
    });
  }

  await prisma.bin.upsert({
    where: { code: "MAIN" },
    update: {},
    create: { code: "MAIN", label: "Main warehouse" },
  });

  const ownerRole = await prisma.role.findUniqueOrThrow({ where: { code: "owner" } });
  const ownerEmail = process.env.SEED_OWNER_EMAIL ?? "owner@example.com";
  const ownerPassword = process.env.SEED_OWNER_PASSWORD ?? "change-me-now";

  const owner = await prisma.user.upsert({
    where: { email: ownerEmail },
    update: {},
    create: {
      name: "Owner",
      email: ownerEmail,
      passwordHash: await argon2.hash(ownerPassword),
    },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: owner.id, roleId: ownerRole.id } },
    update: {},
    create: { userId: owner.id, roleId: ownerRole.id },
  });

  console.log(`Seeded. Owner login: ${ownerEmail} / ${ownerPassword} — change this password immediately.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
