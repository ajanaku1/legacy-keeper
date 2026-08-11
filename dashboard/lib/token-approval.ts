import type { TrackedAssetBalance } from "./useTrackedAssets";

export function tokenNeedsApproval(asset: TrackedAssetBalance): boolean {
  return (
    !asset.distributed &&
    asset.ownerBalance > 0n &&
    asset.availableBalance < asset.ownerBalance
  );
}
