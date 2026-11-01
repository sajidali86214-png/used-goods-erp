import { prisma } from "../../lib/prisma.js";

/** Throws if `date` falls inside a currently-locked (not reopened) period. Called by every ledger posting. */
export async function assertPeriodNotLocked(date: Date): Promise<void> {
  const lock = await prisma.periodLock.findFirst({
    where: {
      periodStart: { lte: date },
      periodEnd: { gte: date },
      reopenedAt: null,
    },
  });
  if (lock) {
    throw new Error(
      `Cannot post into a locked period (${lock.periodStart.toISOString().slice(0, 10)} to ${lock.periodEnd.toISOString().slice(0, 10)}) — ask the owner to reopen it first`,
    );
  }
}

export async function lockPeriod(params: { periodStart: Date; periodEnd: Date; lockedByUserId: string }) {
  return prisma.periodLock.create({
    data: { periodStart: params.periodStart, periodEnd: params.periodEnd, lockedByUserId: params.lockedByUserId },
  });
}

/** Owner-only, per spec section 13 — always leaves an audit trail of who reopened it and why. */
export async function reopenPeriod(params: { periodLockId: string; reopenedByUserId: string; reason: string }) {
  const lock = await prisma.periodLock.findUniqueOrThrow({ where: { id: params.periodLockId } });
  if (lock.reopenedAt) {
    throw new Error("This period is already reopened");
  }

  const updated = await prisma.periodLock.update({
    where: { id: lock.id },
    data: { reopenedByUserId: params.reopenedByUserId, reopenedAt: new Date(), reopenReason: params.reason },
  });

  await prisma.auditEvent.create({
    data: {
      actorUserId: params.reopenedByUserId,
      action: "reopen_period",
      entityType: "PeriodLock",
      entityId: lock.id,
      beforeJson: { reopenedAt: null },
      afterJson: { reopenedAt: updated.reopenedAt },
      reason: params.reason,
    },
  });

  return updated;
}
