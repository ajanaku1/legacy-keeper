import { Suspense } from "react";
import { TelegramRecoveryClient } from "@/components/telegram/TelegramRecoveryClient";

export default function TelegramRecoveryPage() {
  return (
    <Suspense fallback={<main className="telegram-recovery-page">Loading secure entry…</main>}>
      <TelegramRecoveryClient />
    </Suspense>
  );
}
