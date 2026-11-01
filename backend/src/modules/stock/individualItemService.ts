import { runSerializable } from "../../lib/transaction.js";
import { Decimal, assertNonNegative } from "../../lib/money.js";

interface SeparateInput {
  costLayerId: string;
  gradeId: string;
  binId: string;
  photoMediaAssetIds: string[];
  actorUserId: string;
}

/**
 * "Separate one piece for individual sale" (spec section 3.5): transfers one
 * unit out of the bulk saleable pool into an individual-item record, for an
 * Instagram/exact-item listing. Preserves SKU, source lot/cost layer, grade,
 * and cost — this must never create additional inventory. Modeled as a
 * state transfer (saleable -> individual), same pattern as picking, so the
 * cost layer's quantityRemaining (and total physical stock) is untouched.
 * Photos are required for an exact-item listing, enforced here too, not
 * only in the UI.
 */
export async function separateForIndividualSale(input: SeparateInput) {
  if (input.photoMediaAssetIds.length === 0) {
    throw new Error("At least one photo is required to list an individual item");
  }

  return runSerializable(async (tx) => {
    const costLayer = await tx.costLayer.findUniqueOrThrow({
      where: { id: input.costLayerId },
      include: { lot: true },
    });
    const productId = costLayer.lot.productId;
    const one = new Decimal(1);

    const saleableState = await tx.stockState.findUniqueOrThrow({
      where: {
        productId_gradeId_binId_costLayerId_state: {
          productId,
          gradeId: input.gradeId,
          binId: input.binId,
          costLayerId: input.costLayerId,
          state: "saleable",
        },
      },
    });
    const saleableAfter = saleableState.onHandQty.minus(one);
    assertNonNegative(saleableAfter, "No saleable piece available to separate");
    await tx.stockState.update({
      where: { id: saleableState.id },
      data: { onHandQty: saleableAfter, version: { increment: 1 } },
    });

    const individualState = await tx.stockState.findUnique({
      where: {
        productId_gradeId_binId_costLayerId_state: {
          productId,
          gradeId: input.gradeId,
          binId: input.binId,
          costLayerId: input.costLayerId,
          state: "individual",
        },
      },
    });
    if (individualState) {
      await tx.stockState.update({
        where: { id: individualState.id },
        data: { onHandQty: individualState.onHandQty.plus(one), version: { increment: 1 } },
      });
    } else {
      await tx.stockState.create({
        data: {
          productId,
          gradeId: input.gradeId,
          binId: input.binId,
          costLayerId: input.costLayerId,
          state: "individual",
          onHandQty: one,
        },
      });
    }

    const movement = await tx.stockMovement.create({
      data: {
        type: "individual_separate",
        productId,
        gradeId: input.gradeId,
        binId: input.binId,
        costLayerId: input.costLayerId,
        quantity: one,
        relatedDocumentType: "IndividualItem",
        relatedDocumentId: input.costLayerId,
        actorUserId: input.actorUserId,
      },
    });

    return tx.individualItem.create({
      data: {
        productId,
        sourceCostLayerId: input.costLayerId,
        gradeId: input.gradeId,
        status: "listed",
        createdFromMovementId: movement.id,
        photos: { connect: input.photoMediaAssetIds.map((id) => ({ id })) },
      },
    });
  });
}

interface ReturnToBulkInput {
  individualItemId: string;
  binId: string;
  actorUserId: string;
}

/** Returns an unsold individually-listed piece back to the bulk saleable pool. */
export async function returnIndividualItemToBulk(input: ReturnToBulkInput) {
  return runSerializable(async (tx) => {
    const item = await tx.individualItem.findUniqueOrThrow({ where: { id: input.individualItemId } });
    if (item.status !== "listed") {
      throw new Error(`Cannot return an individual item with status "${item.status}" to bulk`);
    }

    const one = new Decimal(1);

    const individualState = await tx.stockState.findUniqueOrThrow({
      where: {
        productId_gradeId_binId_costLayerId_state: {
          productId: item.productId,
          gradeId: item.gradeId,
          binId: input.binId,
          costLayerId: item.sourceCostLayerId,
          state: "individual",
        },
      },
    });
    const individualAfter = individualState.onHandQty.minus(one);
    assertNonNegative(individualAfter, "No individually-listed piece available to return");
    await tx.stockState.update({
      where: { id: individualState.id },
      data: { onHandQty: individualAfter, version: { increment: 1 } },
    });

    const saleableState = await tx.stockState.findUniqueOrThrow({
      where: {
        productId_gradeId_binId_costLayerId_state: {
          productId: item.productId,
          gradeId: item.gradeId,
          binId: input.binId,
          costLayerId: item.sourceCostLayerId,
          state: "saleable",
        },
      },
    });
    await tx.stockState.update({
      where: { id: saleableState.id },
      data: { onHandQty: saleableState.onHandQty.plus(one), version: { increment: 1 } },
    });

    const movement = await tx.stockMovement.create({
      data: {
        type: "individual_return_to_bulk",
        productId: item.productId,
        gradeId: item.gradeId,
        binId: input.binId,
        costLayerId: item.sourceCostLayerId,
        quantity: one,
        relatedDocumentType: "IndividualItem",
        relatedDocumentId: item.id,
        actorUserId: input.actorUserId,
      },
    });

    return tx.individualItem.update({
      where: { id: item.id },
      data: { status: "returned_to_bulk", returnedToMovementId: movement.id },
    });
  });
}
