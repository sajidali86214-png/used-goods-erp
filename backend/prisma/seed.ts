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

  await prisma.bin.upsert({
    where: { code: "MAIN" },
    update: {},
    create: { code: "MAIN", label: "Main warehouse" },
  });

  // Starter categories for a used clothing & bags business — the owner can
  // add more via Settings > Categories.
  for (const name of [
    "Bags",
    "Dresses",
    "Sweaters",
    "Jeans",
    "Jackets",
    "Shirts",
    "T-Shirts",
    "Skirts",
    "Trousers",
    "Shoes",
    "Accessories",
  ]) {
    await prisma.category.upsert({ where: { name }, update: {}, create: { name } });
  }

  const pkr = await prisma.currency.findUniqueOrThrow({ where: { code: "PKR" } });

  // Standard control (non-cash) ledger accounts, all PKR-denominated per
  // spec section 9 (PKR is the base reporting currency). Real bank/cash
  // accounts are created by the owner in Settings, not seeded here.
  const controlAccounts: { code: string; label: string; nature: string }[] = [
    { code: "ACCOUNTS_RECEIVABLE", label: "Accounts Receivable", nature: "asset" },
    { code: "ACCOUNTS_PAYABLE", label: "Accounts Payable", nature: "liability" },
    { code: "SUPPLIER_ADVANCES", label: "Supplier Advances", nature: "asset" },
    { code: "INVENTORY", label: "Inventory", nature: "asset" },
    { code: "COGS", label: "Cost of Goods Sold", nature: "expense" },
    { code: "SALES_REVENUE", label: "Sales Revenue", nature: "revenue" },
    { code: "SALES_RETURNS", label: "Sales Returns & Allowances", nature: "contra_revenue" },
    { code: "OWNERS_EQUITY", label: "Owner's Equity", nature: "equity" },
    { code: "BANK_CHARGES", label: "Bank Charges", nature: "expense" },
    { code: "OPERATING_EXPENSES", label: "Operating Expenses", nature: "expense" },
  ];
  for (const account of controlAccounts) {
    await prisma.account.upsert({
      where: { code: account.code },
      update: {},
      create: { code: account.code, label: account.label, nature: account.nature, currencyId: pkr.id, kind: "control" },
    });
  }

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
