"use client";

import { PageHeader } from "@/components/application/PageHeader";
import { PlanNotice } from "@/components/application/PlanNotice";
import { PlanSettingsEditor } from "@/components/settings/PlanSettingsEditor";

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Plan policy"
        description="Timing, tracked assets, and route disclosures stay together here."
      />
      <PlanNotice />
      <PlanSettingsEditor />
    </>
  );
}
