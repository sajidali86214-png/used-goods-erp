/**
 * Bootstraps the real product catalog + opening stock against a running
 * backend (local or production), via the same API a human would use — not
 * a direct DB write. Safe to re-run: products/suppliers/categories/brands
 * are skipped if they already exist by name; the opening-stock import is
 * blocked from re-committing the same fileRef twice.
 *
 * Usage: API_URL=https://your-api.example.com npx tsx scripts/seed-production-catalog.ts
 * Defaults to http://localhost:3000 and the seeded owner credentials.
 */
import { readFileSync } from "node:fs";

const BASE = process.env.API_URL ?? "http://localhost:3000";
const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? "owner@example.com";
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? "change-me-now";

interface Row {
  skuName: string;
  supplierName: string;
  category: string;
  subCategory: string;
  brand: string;
  color: string;
  size: string;
  gender: string;
  grade: string;
  quantity: number;
  unitPrice: number;
  note?: string;
}

function parseCsv(text: string): Row[] {
  const lines = text.trim().split(/\r?\n/).slice(1);
  return lines.map((line) => {
    const cols = line.split(",");
    return {
      skuName: cols[0]!.trim(),
      supplierName: cols[1]!.trim(),
      category: cols[2]!.trim(),
      subCategory: cols[3]!.trim(),
      brand: cols[4]!.trim(),
      color: cols[5]!.trim(),
      size: cols[6]!.trim(),
      gender: cols[7]!.trim(),
      grade: cols[8]!.trim(),
      quantity: Number(cols[9]),
      unitPrice: Number(cols[10]),
      note: cols[14]?.trim() || undefined,
    };
  });
}

async function api<T>(method: string, path: string, token: string | null, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(data)}`);
  return data as T;
}

async function findOrCreate<T extends { id: string }>(
  existing: T[],
  matchName: string,
  nameField: keyof T,
  createFn: () => Promise<T>,
): Promise<T> {
  const found = existing.find((x) => (x[nameField] as unknown as string) === matchName);
  if (found) return found;
  return createFn();
}

async function main() {
  console.log(`Target API: ${BASE}`);
  const rows = parseCsv(readFileSync(new URL("./opening-inventory.csv", import.meta.url), "utf8"));
  console.log(`Parsed ${rows.length} rows.`);

  const login = await api<{ token: string }>("POST", "/auth/login", null, { email: OWNER_EMAIL, password: OWNER_PASSWORD });
  const token = login.token;

  const currencies = await api<{ id: string; code: string }[]>("GET", "/settings/currencies", token);
  const pkr = currencies.find((c) => c.code === "PKR");
  if (!pkr) throw new Error("PKR currency not found — run prisma/seed.ts against this database first");

  const existingCategories = await api<{ id: string; name: string }[]>("GET", "/settings/categories", token);
  const categoryIdByName = new Map<string, string>();
  for (const name of new Set(rows.map((r) => r.category))) {
    const cat = await findOrCreate(existingCategories, name, "name", () => api("POST", "/settings/categories", token, { name }));
    categoryIdByName.set(name, cat.id);
  }
  console.log(`Categories ready: ${categoryIdByName.size}`);

  const existingBrands = await api<{ id: string; name: string }[]>("GET", "/settings/brands", token);
  const brandIdByName = new Map<string, string>();
  for (const name of new Set(rows.map((r) => r.brand))) {
    const brand = await findOrCreate(existingBrands, name, "name", () => api("POST", "/settings/brands", token, { name }));
    brandIdByName.set(name, brand.id);
  }
  console.log(`Brands ready: ${brandIdByName.size}`);

  const existingSuppliers = await api<{ id: string; name: string }[]>("GET", "/suppliers", token);
  const supplierIdByName = new Map<string, string>();
  for (const name of new Set(rows.map((r) => r.supplierName))) {
    const supplier = await findOrCreate(existingSuppliers, name, "name", () =>
      api("POST", "/suppliers", token, { name, defaultCurrencyId: pkr.id }),
    );
    supplierIdByName.set(name, supplier.id);
  }
  console.log(`Suppliers ready: ${supplierIdByName.size}`);

  const existingProducts = await api<{ id: string; name: string; skuCode: string }[]>("GET", "/products", token);
  const skuCodeByRowName = new Map<string, string>();
  let createdProducts = 0;
  for (const row of rows) {
    const already = existingProducts.find((p) => p.name === row.skuName);
    if (already) {
      skuCodeByRowName.set(row.skuName, already.skuCode);
      continue;
    }
    const descriptionParts = [
      `Sub-category: ${row.subCategory}`,
      `Color: ${row.color}`,
      `Gender: ${row.gender}`,
      `Supplier: ${row.supplierName}`,
    ];
    if (row.note) descriptionParts.push(row.note);
    const created = await api<{ skuCode: string }>("POST", "/products", token, {
      name: row.skuName,
      categoryId: categoryIdByName.get(row.category),
      brandId: brandIdByName.get(row.brand),
      unitOfMeasure: "piece",
      sizeGroup: row.size,
      description: descriptionParts.join(" | "),
    });
    skuCodeByRowName.set(row.skuName, created.skuCode);
    createdProducts += 1;
  }
  console.log(`Products created: ${createdProducts} (of ${rows.length} rows; rest already existed)`);

  const openingStockRows = rows
    .filter((row) => row.quantity > 0)
    .map((row) => ({
      skuCode: skuCodeByRowName.get(row.skuName)!,
      gradeCode: row.grade,
      binCode: "MAIN",
      quantity: row.quantity,
      unitCost: row.unitPrice,
      currencyId: pkr.id,
      notes: `Opening inventory import — supplier ${row.supplierName}`,
    }));

  const importResult = await api<{ status: string; resultSummary: { createdCount: number; totalRows: number } }>(
    "POST",
    "/imports/opening-stock",
    token,
    { fileRef: "opening-inventory-production.csv", allOrNothing: true, rows: openingStockRows },
  );
  console.log("Opening stock import result:", JSON.stringify(importResult, null, 2));
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
