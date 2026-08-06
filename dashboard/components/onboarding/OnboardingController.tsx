"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useSignTypedData } from "wagmi";
import { useApplication } from "@/components/shell/ApplicationShell";
import { LEGACY_KEEPER_FACTORY_ADDRESS } from "@/lib/contract";
import { planCreationTypedData } from "@/lib/intent-signer";
import {
  browserDraftStorage,
  createOnboardingDraft,
  draftStorageKey,
  loadOnboardingDraft,
  saveOnboardingDraft,
  type OnboardingDraft,
} from "@/lib/onboarding-draft";
import {
  buildPlanCreationRequest,
  randomNonce,
  submitPlanCreation,
} from "@/lib/plan-client";
import type { VerifiedPlanEvidence } from "@/lib/plan-route";
import { OnboardingModal } from "./OnboardingModal";

export function OnboardingController() {
  const app = useApplication();
  const router = useRouter();
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const { signTypedDataAsync } = useSignTypedData();
  const owner =
    app.resolution.status === "missing" ? app.resolution.owner : undefined;
  const draftKey = owner ? draftStorageKey(owner, app.chainId ?? 11155111) : "";
  const [draft, setDraft] = useState<OnboardingDraft | null>(null);
  const [dismissedKey, setDismissedKey] = useState("");

  useEffect(() => {
    if (!owner) return setDraft(null);
    const chainId = app.chainId ?? 11155111;
    const storage = browserDraftStorage();
    setDraft(
      storage
        ? loadOnboardingDraft(storage, owner, chainId)
        : createOnboardingDraft(owner, chainId),
    );
    if (pathname !== "/dashboard") router.replace("/dashboard");
  }, [app.chainId, owner, pathname, router]);

  useEffect(() => {
    const storage = browserDraftStorage();
    if (draft && storage) saveOnboardingDraft(storage, draft);
  }, [draft]);

  const update = useCallback((next: OnboardingDraft) => setDraft(next), []);
  const createPlan = useCallback(
    async (reviewedDraft: OnboardingDraft): Promise<VerifiedPlanEvidence> => {
      if (!LEGACY_KEEPER_FACTORY_ADDRESS) {
        throw new Error("The Sepolia factory registry is not configured.");
      }
      if (
        app.chainId !== reviewedDraft.chainId ||
        app.address?.toLowerCase() !== reviewedDraft.owner.toLowerCase()
      ) {
        throw new Error(
          "Wallet or network changed. Return to review and try again.",
        );
      }
      const unsigned = buildPlanCreationRequest(
        reviewedDraft,
        randomNonce(crypto.getRandomValues(new Uint8Array(32))),
        Math.floor(Date.now() / 1_000),
      );
      const signature = await signTypedDataAsync(
        planCreationTypedData(unsigned, LEGACY_KEEPER_FACTORY_ADDRESS),
      );
      return submitPlanCreation({ ...unsigned, signature });
    },
    [app.address, app.chainId, signTypedDataAsync],
  );
  const finish = useCallback(async (): Promise<void> => {
    if (owner) {
      const storage = browserDraftStorage();
      storage?.removeItem(draftStorageKey(owner, app.chainId ?? 11155111));
    }
    await queryClient.invalidateQueries();
  }, [app.chainId, owner, queryClient]);
  const actions = useMemo(
    () => ({
      update,
      dismiss: () => setDismissedKey(draftKey),
      connectWallet: app.connectWallet,
      switchToSepolia: app.switchToSepolia,
      creationAvailable: Boolean(LEGACY_KEEPER_FACTORY_ADDRESS),
      createPlan,
      finish,
    }),
    [
      app.connectWallet,
      app.switchToSepolia,
      createPlan,
      draftKey,
      finish,
      update,
    ],
  );

  if (app.resolution.status !== "missing" || !draft) return null;
  if (dismissedKey === draftKey) {
    return (
      <aside className="setup-resume" aria-live="polite">
        <div>
          <span className="section-label">Setup incomplete</span>
          <strong>Your draft is saved for this wallet.</strong>
        </div>
        <button className="primary compact" onClick={() => setDismissedKey("")}>
          Finish setup
        </button>
      </aside>
    );
  }
  return (
    <OnboardingModal
      draft={draft}
      session={{ owner: app.address, chainId: app.chainId }}
      actions={actions}
    />
  );
}
