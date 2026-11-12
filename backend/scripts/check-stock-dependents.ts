// Read-only safety check before any inventory wipe-and-reimport: confirms
// nothing downstream (reservations, picks, returns, individually-separated
// items) actually references the current Lot/CostLayer rows. If any of
// these are non-zero, a wipe would either fail on a foreign-key constraint
// or (worse) silently orphan real sales history — so this must be checked
// first, not assumed.
import { prisma } from "../src/lib/prisma.js";

async function main() {
  const [lots, costLayers, stockMovements, stockStates, reservations, pickAllocations, returnLines, individualItems, grns, grnLines] =
    await Promise.all([
      prisma.lot.count(),
      prisma.costLayer.count(),
      prisma.stockMovement.count(),
      prisma.stockState.count(),
      prisma.reservation.count(),
      prisma.pickAllocation.count(),
      prisma.returnLine.count(),
      prisma.individualItem.count(),
      prisma.gRN.count(),
      prisma.gRNLine.count(),
    ]);

  console.log({ lots, costLayers, stockMovements, stockStates, reservations, pickAllocations, returnLines, individualItems, grns, grnLines });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
