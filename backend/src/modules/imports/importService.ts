import { prisma } from "../../lib/prisma.js";
import { Decimal } from "../../lib/money.js";

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
