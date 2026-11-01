import { prisma } from "../../lib/prisma.js";
import { Decimal } from "../../lib/money.js";
import { randomUUID } from "node:crypto";

export interface ProductImportRow {
  skuCode: string;
  name: string;
  categoryId: string;
  unitOfMeasure?: string;
  description?: string;
  defaultSellPrice?: number;
  minPrice?: number;
}

export interface RowError {
  row: number; // 1-indexed, matching what a spreadsheet user would see
  message: string;
}

interface ValidationResult {
  validRows: { row: number; data: ProductImportRow }[];
  rowErrors: RowError[];
}

/**
 * Validates product rows before anything is written: required fields,
 * duplicate SKUs WITHIN the file, and SKUs that already exist in the
 * database — all reported with useful per-row messages, never silently
 * dropped or silently overwritten (spec section 14, acceptance test #17).
 */
export async function validateProductRows(rows: ProductImportRow[]): Promise<ValidationResult> {
  const rowErrors: RowError[] = [];
  const seenInFile = new Map<string, number>(); // skuCode -> first row index it appeared on

  rows.forEach((row, i) => {
    const rowNum = i + 1;
    if (!row.skuCode?.trim()) rowErrors.push({ row: rowNum, message: "skuCode is required" });
    if (!row.name?.trim()) rowErrors.push({ row: rowNum, message: "name is required" });
    if (!row.categoryId?.trim()) rowErrors.push({ row: rowNum, message: "categoryId is required" });

    if (row.skuCode) {
      const firstSeenRow = seenInFile.get(row.skuCode);
      if (firstSeenRow !== undefined) {
        rowErrors.push({
          row: rowNum,
          message: `Duplicate skuCode "${row.skuCode}" — already used on row ${firstSeenRow}`,
        });
      } else {
        seenInFile.set(row.skuCode, rowNum);
      }
    }
  });

  const skuCodes = [...new Set(rows.map((r) => r.skuCode).filter(Boolean))];
  const existingProducts = await prisma.product.findMany({
    where: { skuCode: { in: skuCodes } },
    select: { skuCode: true },
  });
  const existingSkuSet = new Set(existingProducts.map((p) => p.skuCode));

  const categoryIds = [...new Set(rows.map((r) => r.categoryId).filter(Boolean))];
  const existingCategories = await prisma.category.findMany({
    where: { id: { in: categoryIds } },
    select: { id: true },
  });
  const existingCategorySet = new Set(existingCategories.map((c) => c.id));

  rows.forEach((row, i) => {
    const rowNum = i + 1;
    if (row.skuCode && existingSkuSet.has(row.skuCode)) {
      rowErrors.push({ row: rowNum, message: `skuCode "${row.skuCode}" already exists` });
    }
    if (row.categoryId && !existingCategorySet.has(row.categoryId)) {
      rowErrors.push({ row: rowNum, message: `categoryId "${row.categoryId}" does not exist` });
    }
  });

  const invalidRowNumbers = new Set(rowErrors.map((e) => e.row));
  const validRows = rows
    .map((data, i) => ({ row: i + 1, data }))
    .filter((r) => !invalidRowNumbers.has(r.row));

  return { validRows, rowErrors };
}

/**
 * Commits a product import. Transactional document imports default to
 * all-or-nothing (spec section 14): if ANY row fails validation, nothing
 * is created and the job is marked failed with the full error list — never
 * a silent partial document. Passing allOrNothing:false explicitly accepts
 * the valid rows and records the rest as skipped, with the same errors
 * visible on the job.
 */
export async function commitProductImport(params: {
  fileRef: string;
  rows: ProductImportRow[];
  allOrNothing?: boolean;
}) {
  const allOrNothing = params.allOrNothing ?? true;
  const { validRows, rowErrors } = await validateProductRows(params.rows);

  if (allOrNothing && rowErrors.length > 0) {
    return prisma.importJob.create({
      data: {
        kind: "products",
        fileRef: params.fileRef,
        status: "failed",
        allOrNothing,
        errors: rowErrors as unknown as object,
        resultSummary: { createdCount: 0, totalRows: params.rows.length } as unknown as object,
      },
    });
  }

  const created = await prisma.$transaction(
    validRows.map((r) =>
      prisma.product.create({
        data: {
          skuCode: r.data.skuCode,
          name: r.data.name,
          categoryId: r.data.categoryId,
          unitOfMeasure: r.data.unitOfMeasure ?? "piece",
          description: r.data.description,
          defaultSellPrice: r.data.defaultSellPrice !== undefined ? new Decimal(r.data.defaultSellPrice) : undefined,
          minPrice: r.data.minPrice !== undefined ? new Decimal(r.data.minPrice) : undefined,
        },
      }),
    ),
  );

  return prisma.importJob.create({
    data: {
      kind: "products",
      fileRef: params.fileRef,
      status: rowErrors.length > 0 ? "partially_committed" : "committed",
      allOrNothing,
      errors: rowErrors.length > 0 ? (rowErrors as unknown as object) : undefined,
      resultSummary: {
        createdCount: created.length,
        skippedCount: rowErrors.length,
        totalRows: params.rows.length,
      } as unknown as object,
    },
  });
}

// ---------- Suppliers (opening-data go-live, spec section 17) ----------

export interface SupplierImportRow {
  name: string;
  defaultCurrencyId: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
}

export async function validateSupplierRows(rows: SupplierImportRow[]): Promise<{
  validRows: { row: number; data: SupplierImportRow }[];
  rowErrors: RowError[];
}> {
  const rowErrors: RowError[] = [];
  const seenInFile = new Map<string, number>();

  rows.forEach((row, i) => {
    const rowNum = i + 1;
    if (!row.name?.trim()) rowErrors.push({ row: rowNum, message: "name is required" });
    if (!row.defaultCurrencyId?.trim()) rowErrors.push({ row: rowNum, message: "defaultCurrencyId is required" });

    const key = row.name?.trim().toLowerCase();
    if (key) {
      const firstSeenRow = seenInFile.get(key);
      if (firstSeenRow !== undefined) {
        rowErrors.push({ row: rowNum, message: `Duplicate supplier name "${row.name}" — already used on row ${firstSeenRow}` });
      } else {
        seenInFile.set(key, rowNum);
      }
    }
  });

  const currencyIds = [...new Set(rows.map((r) => r.defaultCurrencyId).filter(Boolean))];
  const existingCurrencies = await prisma.currency.findMany({ where: { id: { in: currencyIds } }, select: { id: true } });
  const existingCurrencySet = new Set(existingCurrencies.map((c) => c.id));
  rows.forEach((row, i) => {
    if (row.defaultCurrencyId && !existingCurrencySet.has(row.defaultCurrencyId)) {
      rowErrors.push({ row: i + 1, message: `defaultCurrencyId "${row.defaultCurrencyId}" does not exist` });
    }
  });

  const invalidRowNumbers = new Set(rowErrors.map((e) => e.row));
  const validRows = rows.map((data, i) => ({ row: i + 1, data })).filter((r) => !invalidRowNumbers.has(r.row));
  return { validRows, rowErrors };
}

export async function commitSupplierImport(params: { fileRef: string; rows: SupplierImportRow[]; allOrNothing?: boolean }) {
  const allOrNothing = params.allOrNothing ?? true;
  const { validRows, rowErrors } = await validateSupplierRows(params.rows);

  if (allOrNothing && rowErrors.length > 0) {
    return prisma.importJob.create({
      data: { kind: "suppliers", fileRef: params.fileRef, status: "failed", allOrNothing, errors: rowErrors as unknown as object, resultSummary: { createdCount: 0, totalRows: params.rows.length } as unknown as object },
    });
  }

  const created = await prisma.$transaction(
    validRows.map((r) =>
      prisma.supplier.create({
        data: {
          name: r.data.name,
          defaultCurrencyId: r.data.defaultCurrencyId,
          contactPerson: r.data.contactPerson,
          phone: r.data.phone,
          email: r.data.email,
          address: r.data.address,
        },
      }),
    ),
  );

  return prisma.importJob.create({
    data: {
      kind: "suppliers",
      fileRef: params.fileRef,
      status: rowErrors.length > 0 ? "partially_committed" : "committed",
      allOrNothing,
      errors: rowErrors.length > 0 ? (rowErrors as unknown as object) : undefined,
      resultSummary: { createdCount: created.length, skippedCount: rowErrors.length, totalRows: params.rows.length } as unknown as object,
    },
  });
}

// ---------- Customers (opening-data go-live, spec section 17) ----------

export interface CustomerImportRow {
  name: string;
  contact?: string;
  address?: string;
  notes?: string;
}

export async function validateCustomerRows(rows: CustomerImportRow[]): Promise<{
  validRows: { row: number; data: CustomerImportRow }[];
  rowErrors: RowError[];
}> {
  const rowErrors: RowError[] = [];
  rows.forEach((row, i) => {
    if (!row.name?.trim()) rowErrors.push({ row: i + 1, message: "name is required" });
  });
  const invalidRowNumbers = new Set(rowErrors.map((e) => e.row));
  const validRows = rows.map((data, i) => ({ row: i + 1, data })).filter((r) => !invalidRowNumbers.has(r.row));
  return { validRows, rowErrors };
}

export async function commitCustomerImport(params: { fileRef: string; rows: CustomerImportRow[]; allOrNothing?: boolean }) {
  const allOrNothing = params.allOrNothing ?? true;
  const { validRows, rowErrors } = await validateCustomerRows(params.rows);

  if (allOrNothing && rowErrors.length > 0) {
    return prisma.importJob.create({
      data: { kind: "customers", fileRef: params.fileRef, status: "failed", allOrNothing, errors: rowErrors as unknown as object, resultSummary: { createdCount: 0, totalRows: params.rows.length } as unknown as object },
    });
  }

  const created = await prisma.$transaction(
    validRows.map((r) => prisma.customer.create({ data: { name: r.data.name, contact: r.data.contact, address: r.data.address, notes: r.data.notes } })),
  );

  return prisma.importJob.create({
    data: {
      kind: "customers",
      fileRef: params.fileRef,
      status: rowErrors.length > 0 ? "partially_committed" : "committed",
      allOrNothing,
      errors: rowErrors.length > 0 ? (rowErrors as unknown as object) : undefined,
      resultSummary: { createdCount: created.length, skippedCount: rowErrors.length, totalRows: params.rows.length } as unknown as object,
    },
  });
}

// ---------- Opening stock (go-live cutover, spec section 17) ----------

export interface OpeningStockImportRow {
  skuCode: string;
  gradeCode: string;
  binCode: string;
  quantity: number;
  unitCost: number; // actual or documented estimate — flagged via `costIsEstimated`
  currencyId: string;
  costIsEstimated?: boolean;
  notes?: string;
}

export async function validateOpeningStockRows(rows: OpeningStockImportRow[]): Promise<{
  validRows: { row: number; data: OpeningStockImportRow; productId: string; gradeId: string; binId: string }[];
  rowErrors: RowError[];
}> {
  const rowErrors: RowError[] = [];

  rows.forEach((row, i) => {
    const rowNum = i + 1;
    if (!row.skuCode?.trim()) rowErrors.push({ row: rowNum, message: "skuCode is required" });
    if (!row.gradeCode?.trim()) rowErrors.push({ row: rowNum, message: "gradeCode is required" });
    if (!row.binCode?.trim()) rowErrors.push({ row: rowNum, message: "binCode is required" });
    if (!(row.quantity > 0)) rowErrors.push({ row: rowNum, message: "quantity must be positive" });
    if (row.unitCost === undefined || row.unitCost < 0) rowErrors.push({ row: rowNum, message: "unitCost must be zero or positive" });
  });

  const skuCodes = [...new Set(rows.map((r) => r.skuCode).filter(Boolean))];
  const products = await prisma.product.findMany({ where: { skuCode: { in: skuCodes } } });
  const productBySkuCode = new Map(products.map((p) => [p.skuCode, p]));

  const gradeCodes = [...new Set(rows.map((r) => r.gradeCode).filter(Boolean))];
  const grades = await prisma.grade.findMany({ where: { code: { in: gradeCodes } } });
  const gradeByCode = new Map(grades.map((g) => [g.code, g]));

  const binCodes = [...new Set(rows.map((r) => r.binCode).filter(Boolean))];
  const bins = await prisma.bin.findMany({ where: { code: { in: binCodes } } });
  const binByCode = new Map(bins.map((b) => [b.code, b]));

  const resolved: { row: number; data: OpeningStockImportRow; productId: string; gradeId: string; binId: string }[] = [];

  rows.forEach((row, i) => {
    const rowNum = i + 1;
    const product = productBySkuCode.get(row.skuCode);
    const grade = gradeByCode.get(row.gradeCode);
    const bin = binByCode.get(row.binCode);
    if (row.skuCode && !product) rowErrors.push({ row: rowNum, message: `skuCode "${row.skuCode}" does not exist` });
    if (row.gradeCode && !grade) rowErrors.push({ row: rowNum, message: `gradeCode "${row.gradeCode}" does not exist` });
    if (row.binCode && !bin) rowErrors.push({ row: rowNum, message: `binCode "${row.binCode}" does not exist` });
    if (product && grade && bin) {
      resolved.push({ row: rowNum, data: row, productId: product.id, gradeId: grade.id, binId: bin.id });
    }
  });

  const invalidRowNumbers = new Set(rowErrors.map((e) => e.row));
  const validRows = resolved.filter((r) => !invalidRowNumbers.has(r.row));
  return { validRows, rowErrors };
}

/**
 * Commits opening stock balances at go-live cutover. Each row becomes its
 * own Lot + CostLayer (no GRN — there's no physical receipt event for an
 * opening balance) landed directly in saleable stock, with a dedicated
 * `opening_stock` movement type for audit traceability. Guards against
 * re-running the same opening-stock file and duplicating balances (spec
 * section 17) by rejecting a fileRef that's already been committed.
 */
export async function commitOpeningStockImport(params: {
  fileRef: string;
  rows: OpeningStockImportRow[];
  actorUserId: string;
  allOrNothing?: boolean;
}) {
  const priorCommit = await prisma.importJob.findFirst({
    where: { kind: "opening_stock", fileRef: params.fileRef, status: { in: ["committed", "partially_committed"] } },
  });
  if (priorCommit) {
    throw new Error(
      `An opening-stock import with fileRef "${params.fileRef}" was already committed (importJob ${priorCommit.id}) — re-running it would duplicate opening balances`,
    );
  }

  const allOrNothing = params.allOrNothing ?? true;
  const { validRows, rowErrors } = await validateOpeningStockRows(params.rows);

  if (allOrNothing && rowErrors.length > 0) {
    return prisma.importJob.create({
      data: { kind: "opening_stock", fileRef: params.fileRef, status: "failed", allOrNothing, errors: rowErrors as unknown as object, resultSummary: { createdCount: 0, totalRows: params.rows.length } as unknown as object },
    });
  }

  let createdCount = 0;
  for (const r of validRows) {
    await prisma.$transaction(async (tx) => {
      const lot = await tx.lot.create({
        data: {
          lotCode: `OPENING-${r.data.skuCode}-${randomUUID().slice(0, 8)}`,
          productId: r.productId,
          originalCurrencyId: r.data.currencyId,
          sourceUnitPrice: new Decimal(r.data.unitCost),
          exchangeRate: 1,
          notes: r.data.costIsEstimated ? `Opening stock — estimated cost. ${r.data.notes ?? ""}`.trim() : r.data.notes,
        },
      });
      const costLayer = await tx.costLayer.create({
        data: {
          lotId: lot.id,
          gradeId: r.gradeId,
          binId: r.binId,
          quantityOriginal: new Decimal(r.data.quantity),
          quantityRemaining: new Decimal(r.data.quantity),
          unitCost: new Decimal(r.data.unitCost),
        },
      });
      await tx.stockState.create({
        data: {
          productId: r.productId,
          gradeId: r.gradeId,
          binId: r.binId,
          costLayerId: costLayer.id,
          state: "saleable",
          onHandQty: new Decimal(r.data.quantity),
        },
      });
      await tx.stockMovement.create({
        data: {
          type: "opening_stock",
          productId: r.productId,
          gradeId: r.gradeId,
          binId: r.binId,
          costLayerId: costLayer.id,
          quantity: new Decimal(r.data.quantity),
          relatedDocumentType: "ImportRow",
          relatedDocumentId: `${params.fileRef}:${r.row}`,
          actorUserId: params.actorUserId,
        },
      });
    });
    createdCount += 1;
  }

  return prisma.importJob.create({
    data: {
      kind: "opening_stock",
      fileRef: params.fileRef,
      status: rowErrors.length > 0 ? "partially_committed" : "committed",
      allOrNothing,
      errors: rowErrors.length > 0 ? (rowErrors as unknown as object) : undefined,
      resultSummary: { createdCount, skippedCount: rowErrors.length, totalRows: params.rows.length } as unknown as object,
    },
  });
}
