import { isAddress } from "viem";
import type { ActivityRepository } from "./activity-ledger";

export class InvalidActivityRequestError extends Error {}

export async function loadWalletActivity(
  owner: string,
  requestedPage: number,
  repository: ActivityRepository,
) {
  const normalizedOwner = normalizeOwner(owner);
  const page = Number.isInteger(requestedPage) && requestedPage > 0
    ? requestedPage
    : 1;
  return repository.listByOwner(normalizedOwner, page, 5);
}

function normalizeOwner(owner: string): string {
  const normalized = owner.toLowerCase();
  if (!isAddress(normalized)) {
    throw new InvalidActivityRequestError("Valid owner required.");
  }
  return normalized;
}
