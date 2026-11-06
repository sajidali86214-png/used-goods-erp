/**
 * Generates a human-readable sequential document number (e.g. "PO-0001",
 * "GRN-0007", "SO-0042") — never typed by hand, same principle as SKU
 * auto-generation. Retries a few times on the rare collision instead of
 * letting the DB's unique constraint surface as a raw 500.
 */
export async function generateSequentialNumber(params: {
  prefix: string;
  countExisting: () => Promise<number>;
  exists: (candidate: string) => Promise<boolean>;
  padLength?: number;
}): Promise<string> {
  const padLength = params.padLength ?? 4;
  let seq = (await params.countExisting()) + 1;

  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = `${params.prefix}-${String(seq).padStart(padLength, "0")}`;
    if (!(await params.exists(candidate))) return candidate;
    seq += 1;
  }
  throw new Error(`Could not generate a unique ${params.prefix} number — please retry`);
}
