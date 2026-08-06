"use client";

import { PageHeader } from "@/components/application/PageHeader";
import { PlanNotice } from "@/components/application/PlanNotice";
import { useApplication } from "@/components/shell/ApplicationShell";
import { shortAddress } from "@/lib/format";

export default function BeneficiariesPage() {
  const { keeper } = useApplication();
  const complete = keeper.totalShareBps === 10_000;

  return (
    <>
      <PageHeader
        eyebrow="Beneficiaries"
        title="Allocation register"
        description="Add up to ten wallet addresses. A live allocation must total exactly 100%."
        status={
          <span className={`status-chip ${complete ? "verified" : ""}`}>
            {complete
              ? "● Complete"
              : `○ ${keeper.totalShareBps / 100}% assigned`}
          </span>
        }
      />
      <PlanNotice />
      <section className="ledger-card" aria-labelledby="beneficiary-title">
        <header className="ledger-head">
          <h2 id="beneficiary-title">Beneficiaries</h2>
          <span>Allocation</span>
        </header>
        {keeper.beneficiaries.length === 0 ? (
          <div className="empty-state">
            <span aria-hidden="true">◎</span>
            <h2>No beneficiaries are registered.</h2>
            <p>
              Setup will require at least one nonzero address and an exact 100%
              total.
            </p>
          </div>
        ) : (
          <div className="people-list">
            {keeper.beneficiaries.map((person, index) => (
              <article className="person-row" key={person.wallet}>
                <span
                  className="person-mark"
                  aria-label={`Beneficiary ${index + 1}`}
                >
                  {index + 1}
                </span>
                <div>
                  <strong>{shortAddress(person.wallet, 8, 6)}</strong>
                  <span className="mono">{person.wallet}</span>
                </div>
                <b>{person.shareBps / 100}%</b>
              </article>
            ))}
          </div>
        )}
      </section>
      <p className="address-capacity">
        {keeper.beneficiaries.length} of 10 addresses
      </p>
    </>
  );
}
