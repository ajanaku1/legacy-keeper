'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  validateOnboardingStep,
  type AssetDraft,
  type BeneficiaryDraft,
  type OnboardingDraft,
  type WalletSession,
} from '@/lib/onboarding-draft';
import { shortAddress } from '@/lib/format';
import type { VerifiedPlanEvidence } from '@/lib/plan-route';

export const ONBOARDING_STEPS = [
  { label: 'Welcome' },
  { label: 'Timing' },
  { label: 'Beneficiaries' },
  { label: 'Recovery' },
  { label: 'Assets', optional: true },
  { label: 'Review & sign' },
  { label: 'Verify' },
] as const;

interface ModalActions {
  update: (draft: OnboardingDraft) => void;
  dismiss: () => void;
  connectWallet: () => void;
  switchToSepolia: () => void;
  creationAvailable: boolean;
  createPlan: (draft: OnboardingDraft) => Promise<VerifiedPlanEvidence>;
  finish: () => void;
}

export interface OnboardingModalProps {
  draft: OnboardingDraft;
  session: WalletSession;
  actions: ModalActions;
}

interface StepEditor {
  draft: OnboardingDraft;
  change: (patch: Partial<OnboardingDraft>) => void;
}

export function OnboardingModal(props: OnboardingModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [creating, setCreating] = useState(false);
  const [creation, setCreation] = useState<VerifiedPlanEvidence>();
  const [creationError, setCreationError] = useState('');
  useDialogFocus(dialogRef, props.actions.dismiss);
  const change = (patch: Partial<OnboardingDraft>) =>
    props.actions.update({ ...props.draft, ...patch, updatedAt: Date.now() });
  const errors = validateOnboardingStep(
    props.draft,
    props.draft.step,
    props.session,
  );
  const createPlan = async () => {
    setCreating(true);
    setCreationError('');
    try {
      const evidence = await props.actions.createPlan(props.draft);
      if (evidence.stage === 'verified') {
        setCreation(evidence);
        change({ step: 7 });
      }
    } catch (error) {
      setCreationError(
        error instanceof Error ? error.message : 'Plan creation failed.',
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="onboarding-backdrop">
      <div
        className="onboarding-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        ref={dialogRef}
        tabIndex={-1}
      >
        <ModalHeader step={props.draft.step} dismiss={props.actions.dismiss} />
        <StepRail current={props.draft.step} />
        <div className="onboarding-body">
          <StepContent
            editor={{ draft: props.draft, change }}
            session={props.session}
            actions={props.actions}
            creation={creation}
          />
        </div>
        <ModalFooter
          draft={props.draft}
          errors={errors}
          change={change}
          creating={creating}
          creation={creation}
          creationError={creationError}
          creationAvailable={props.actions.creationAvailable}
          createPlan={createPlan}
          finish={props.actions.finish}
        />
      </div>
    </div>
  );
}

function ModalHeader({ step, dismiss }: { step: number; dismiss: () => void }) {
  return (
    <header className="onboarding-head">
      <div>
        <span className="section-label">Plan setup · Step {step} of 7</span>
        <h1 id="onboarding-title">{ONBOARDING_STEPS[step - 1]?.label}</h1>
      </div>
      <button
        className="icon-button"
        type="button"
        aria-label="Close setup"
        onClick={dismiss}
      >
        ×
      </button>
    </header>
  );
}

function StepRail({ current }: { current: number }) {
  return (
    <ol className="onboarding-steps" aria-label="Setup progress">
      {ONBOARDING_STEPS.map((step, index) => {
        const number = index + 1;
        return (
          <li key={step.label} data-state={stepState(number, current)}>
            <span>{number}</span>
            <strong>{step.label}</strong>
            {'optional' in step && <small>Optional</small>}
          </li>
        );
      })}
    </ol>
  );
}

function StepContent({
  editor,
  session,
  actions,
  creation,
}: {
  editor: StepEditor;
  session: WalletSession;
  actions: ModalActions;
  creation?: VerifiedPlanEvidence;
}) {
  switch (editor.draft.step) {
    case 1:
      return (
        <WelcomeStep editor={editor} session={session} actions={actions} />
      );
    case 2:
      return <TimingStep editor={editor} />;
    case 3:
      return <BeneficiariesStep editor={editor} />;
    case 4:
      return <RecoveryStep editor={editor} />;
    case 5:
      return <AssetsStep editor={editor} />;
    case 6:
      return <ReviewStep draft={editor.draft} />;
    default:
      return <VerifyStep evidence={creation} />;
  }
}

function WelcomeStep({
  editor,
  session,
  actions,
}: {
  editor: StepEditor;
  session: WalletSession;
  actions: ModalActions;
}) {
  const connected = Boolean(session.owner);
  const onSepolia = session.chainId === 11155111;
  return (
    <section className="step-panel">
      <StepIntro
        title="Build one plan for this wallet."
        body="Your continuity agent records inactivity rules, beneficiaries, and recovery controls before anything can be signed."
      />
      <div className="connection-register">
        <StatusLine label="Owner wallet" ready={connected}>
          {session.owner ? shortAddress(session.owner, 8, 6) : 'Not connected'}
        </StatusLine>
        <StatusLine label="Network" ready={onSepolia}>
          {onSepolia ? 'Sepolia' : 'Sepolia required'}
        </StatusLine>
      </div>
      {!connected && (
        <button
          className="secondary"
          type="button"
          onClick={actions.connectWallet}
        >
          Connect wallet
        </button>
      )}
      {connected && !onSepolia && (
        <button
          className="secondary"
          type="button"
          onClick={actions.switchToSepolia}
        >
          Switch to Sepolia
        </button>
      )}
      <p className="trust-note">
        Drafts stay in this browser and are scoped to{' '}
        <span className="mono">{shortAddress(editor.draft.owner, 6, 4)}</span>.
      </p>
    </section>
  );
}

function TimingStep({ editor }: { editor: StepEditor }) {
  const presets = [30, 60, 90, 180];
  return (
    <section className="step-panel">
      <StepIntro
        title="Choose when recovery can begin."
        body="The inactivity period starts after your last verified check-in. A grace period follows before inheritance can execute."
      />
      <fieldset>
        <legend>Inactivity period</legend>
        <div className="preset-grid">
          {presets.map((days) => (
            <button
              type="button"
              className={
                editor.draft.timeoutDays === days ? 'choice active' : 'choice'
              }
              aria-pressed={editor.draft.timeoutDays === days}
              onClick={() => editor.change({ timeoutDays: days })}
              key={days}
            >
              {days} days
            </button>
          ))}
        </div>
      </fieldset>
      <div className="field-grid">
        <NumberField
          id="timeout-days"
          label="Custom inactivity days"
          value={editor.draft.timeoutDays}
          onChange={(timeoutDays) => editor.change({ timeoutDays })}
        />
        <NumberField
          id="grace-days"
          label="Grace period days"
          value={editor.draft.graceDays}
          onChange={(graceDays) => editor.change({ graceDays })}
        />
      </div>
      <p className="timeline-copy">
        Last check-in → {editor.draft.timeoutDays} days inactive →{' '}
        {editor.draft.graceDays}-day grace → inheritance eligible
      </p>
      {editor.draft.graceDays === 0 && (
        <p className="warning-note">
          Zero grace removes the final recovery window. Inheritance becomes
          callable as soon as inactivity expires and may already be callable.
        </p>
      )}
    </section>
  );
}

function BeneficiariesStep({ editor }: { editor: StepEditor }) {
  const total = editor.draft.beneficiaries.reduce(
    (sum, item) => sum + item.sharePercent,
    0,
  );
  return (
    <section className="step-panel">
      <StepIntro
        title="Set who receives the estate."
        body="Add up to 10 wallet addresses. Shares must total exactly 100%."
      />
      <div className="entry-list">
        {editor.draft.beneficiaries.map((item, index) => (
          <BeneficiaryRow
            key={`beneficiary-${index}`}
            item={item}
            index={index}
            editor={editor}
          />
        ))}
      </div>
      <button
        className="secondary"
        type="button"
        disabled={editor.draft.beneficiaries.length >= 10}
        onClick={() =>
          editor.change({
            beneficiaries: [
              ...editor.draft.beneficiaries,
              { address: '', sharePercent: 0 },
            ],
          })
        }
      >
        + Add beneficiary
      </button>
      <p
        className={
          total === 100 ? 'allocation-total verified' : 'allocation-total'
        }
      >
        Allocated: {total}% / 100%
      </p>
    </section>
  );
}

function BeneficiaryRow({
  item,
  index,
  editor,
}: {
  item: BeneficiaryDraft;
  index: number;
  editor: StepEditor;
}) {
  const update = (patch: Partial<BeneficiaryDraft>) => {
    const beneficiaries = editor.draft.beneficiaries.map((entry, position) =>
      position === index ? { ...entry, ...patch } : entry,
    );
    editor.change({ beneficiaries });
  };
  const remove = () =>
    editor.change({
      beneficiaries: editor.draft.beneficiaries.filter(
        (_entry, position) => position !== index,
      ),
    });
  return (
    <div className="entry-row">
      <TextField
        id={`beneficiary-${index}`}
        label={`Beneficiary ${index + 1} address`}
        value={item.address}
        placeholder="0x…"
        onChange={(address) => update({ address })}
      />
      <NumberField
        id={`beneficiary-share-${index}`}
        label="Share %"
        value={item.sharePercent}
        onChange={(sharePercent) => update({ sharePercent })}
      />
      <button className="remove-button" type="button" onClick={remove}>
        Remove
      </button>
    </div>
  );
}

function RecoveryStep({ editor }: { editor: StepEditor }) {
  const shared =
    editor.draft.recoverySigner.length > 0 &&
    editor.draft.recoverySigner.toLowerCase() ===
      editor.draft.safeVault.toLowerCase();
  return (
    <section className="step-panel">
      <StepIntro
        title="Separate recovery authority from custody."
        body="The recovery signer can authorize an emergency sweep. The safe vault receives swept assets. Neither can be the owner wallet."
      />
      <TextField
        id="recovery-signer"
        label="Recovery signer address"
        value={editor.draft.recoverySigner}
        placeholder="0x…"
        onChange={(recoverySigner) => editor.change({ recoverySigner })}
      />
      <TextField
        id="safe-vault"
        label="Safe vault address"
        value={editor.draft.safeVault}
        placeholder="0x…"
        onChange={(safeVault) => editor.change({ safeVault })}
      />
      {shared && (
        <label className="check-row">
          <input
            type="checkbox"
            checked={editor.draft.allowSharedRecovery}
            onChange={(event) =>
              editor.change({ allowSharedRecovery: event.target.checked })
            }
          />
          <span>
            I understand that one address will both authorize and receive an
            emergency sweep.
          </span>
        </label>
      )}
      <p className="trust-note">Only public wallet addresses belong here.</p>
    </section>
  );
}

function AssetsStep({ editor }: { editor: StepEditor }) {
  return (
    <section className="step-panel">
      <StepIntro
        title="Track assets now or add them later."
        body="Asset setup is optional. Tokens need allowance or permit readiness before an emergency sweep can move them."
      />
      <div className="entry-list">
        {editor.draft.assets.map((asset, index) => (
          <AssetRow
            key={`asset-${index}`}
            asset={asset}
            index={index}
            editor={editor}
          />
        ))}
      </div>
      <button
        className="secondary"
        type="button"
        onClick={() =>
          editor.change({
            assets: [
              ...editor.draft.assets,
              { address: '', symbol: '', permitReadiness: 'unknown' },
            ],
          })
        }
      >
        + Add ERC-20 token
      </button>
      <label className="check-row">
        <input
          type="checkbox"
          checked={editor.draft.includeNativeFunding}
          onChange={(event) =>
            editor.change({ includeNativeFunding: event.target.checked })
          }
        />
        <span>Include a separate native ETH transfer after plan creation.</span>
      </label>
      {editor.draft.assets.length === 0 &&
        !editor.draft.includeNativeFunding && (
          <p className="warning-note">
            An unfunded plan records your rules but protects no assets.
          </p>
        )}
    </section>
  );
}

function AssetRow({
  asset,
  index,
  editor,
}: {
  asset: AssetDraft;
  index: number;
  editor: StepEditor;
}) {
  const update = (patch: Partial<AssetDraft>) => {
    const assets = editor.draft.assets.map((entry, position) =>
      position === index ? { ...entry, ...patch } : entry,
    );
    editor.change({ assets });
  };
  return (
    <div className="entry-row asset-entry">
      <TextField
        id={`asset-${index}`}
        label={`Token ${index + 1} contract`}
        value={asset.address}
        placeholder="0x…"
        onChange={(address) => update({ address })}
      />
      <TextField
        id={`asset-symbol-${index}`}
        label="Symbol"
        value={asset.symbol}
        placeholder="USDC"
        onChange={(symbol) => update({ symbol })}
      />
      <label className="form-field">
        <span>Permit readiness</span>
        <select
          value={asset.permitReadiness}
          onChange={(event) =>
            update({
              permitReadiness: event.target
                .value as AssetDraft['permitReadiness'],
            })
          }
        >
          <option value="unknown">Check later</option>
          <option value="supported">Permit supported</option>
          <option value="unsupported">Allowance required</option>
        </select>
      </label>
    </div>
  );
}

function ReviewStep({ draft }: { draft: OnboardingDraft }) {
  return (
    <section className="step-panel">
      <StepIntro
        title="Review every instruction before signing."
        body="The connected wallet and network will be checked again before a plan-creation signature is requested."
      />
      <dl className="review-register">
        <ReviewLine label="Owner" value={draft.owner} />
        <ReviewLine
          label="Timing"
          value={`${draft.timeoutDays} days + ${draft.graceDays}-day grace`}
        />
        <ReviewLine
          label="Beneficiaries"
          value={`${draft.beneficiaries.length} addresses · 100% allocated`}
        />
        <ReviewLine label="Recovery signer" value={draft.recoverySigner} />
        <ReviewLine label="Safe vault" value={draft.safeVault} />
        <ReviewLine
          label="Assets"
          value={
            draft.assets.length
              ? `${draft.assets.length} tracked tokens`
              : 'None yet'
          }
        />
        <ReviewLine
          label="Native ETH"
          value={
            draft.includeNativeFunding
              ? 'Separate transfer planned'
              : 'Not included'
          }
        />
      </dl>
      <p className="trust-note">
        One wallet signature authorizes this exact reviewed configuration. It
        does not send a wallet transaction.
      </p>
    </section>
  );
}

function VerifyStep({ evidence }: { evidence?: VerifiedPlanEvidence }) {
  const verified = evidence?.stage === 'verified';
  return (
    <section className="step-panel">
      <StepIntro
        title="Verify creation before relying on the plan."
        body="LegacyKeeper will require KeeperHub settlement, a successful receipt, the PlanCreated event, the new plan address, and readable on-chain state."
      />
      <div className="connection-register">
        <StatusLine label="KeeperHub submission" ready={verified}>
          {verified ? evidence.executionId : 'Not submitted'}
        </StatusLine>
        <StatusLine label="Transaction receipt" ready={verified}>
          {verified ? 'Successful' : 'Not available'}
        </StatusLine>
        <StatusLine label="PlanCreated event" ready={verified}>
          {verified ? 'Confirmed' : 'Not available'}
        </StatusLine>
        <StatusLine label="Plan state" ready={verified}>
          {verified ? shortAddress(evidence.plan, 8, 6) : 'Not available'}
        </StatusLine>
      </div>
    </section>
  );
}

function ModalFooter({
  draft,
  errors,
  change,
  creating,
  creation,
  creationError,
  creationAvailable,
  createPlan,
  finish,
}: {
  draft: OnboardingDraft;
  errors: string[];
  change: (patch: Partial<OnboardingDraft>) => void;
  creating: boolean;
  creation?: VerifiedPlanEvidence;
  creationError: string;
  creationAvailable: boolean;
  createPlan: () => Promise<void>;
  finish: () => void;
}) {
  const atReview = draft.step === 6;
  const verified = creation?.stage === 'verified';
  const disabled =
    errors.length > 0 || creating || (atReview && !creationAvailable);
  const reason =
    creationError ||
    errors[0] ||
    (atReview && !creationAvailable
      ? 'The Sepolia factory registry is not configured.'
      : '');
  let primaryLabel = 'Continue';
  let primaryAction = () => change({ step: draft.step + 1 });
  if (atReview) {
    primaryLabel = creating
      ? 'Waiting for verification'
      : 'Sign and create plan';
    primaryAction = createPlan;
  }
  if (draft.step === 7) {
    primaryLabel = 'Open verified dashboard';
    primaryAction = finish;
  }
  return (
    <footer className="onboarding-footer">
      <button
        className="secondary"
        type="button"
        disabled={draft.step === 1 || draft.step === 7 || creating}
        onClick={() => change({ step: draft.step - 1 })}
      >
        Back
      </button>
      <div>
        <button
          className="primary compact"
          type="button"
          disabled={draft.step === 7 ? !verified : disabled}
          onClick={primaryAction}
        >
          {primaryLabel}
        </button>
        {reason && (
          <p className="disabled-reason" role="status">
            {reason}
          </p>
        )}
      </div>
    </footer>
  );
}

function StepIntro({ title, body }: { title: string; body: string }) {
  return (
    <div className="step-intro">
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  );
}

function StatusLine({
  label,
  ready,
  children,
}: {
  label: string;
  ready: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <span>{label}</span>
      <strong className={ready ? 'verified' : ''}>
        {ready ? '●' : '○'} {children}
      </strong>
    </div>
  );
}

function ReviewLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value || 'Not set'}</dd>
    </div>
  );
}

function TextField(props: {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="form-field" htmlFor={props.id}>
      <span>{props.label}</span>
      <input
        id={props.id}
        value={props.value}
        placeholder={props.placeholder}
        autoComplete="off"
        onChange={(event) => props.onChange(event.target.value)}
      />
    </label>
  );
}

function NumberField(props: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const onChange = (event: ChangeEvent<HTMLInputElement>) =>
    props.onChange(Number(event.target.value));
  return (
    <label className="form-field" htmlFor={props.id}>
      <span>{props.label}</span>
      <input
        id={props.id}
        type="number"
        min="0"
        value={props.value}
        onChange={onChange}
      />
    </label>
  );
}

function useDialogFocus(
  dialogRef: React.RefObject<HTMLDivElement | null>,
  dismiss: () => void,
) {
  useEffect(() => {
    const dialog = dialogRef.current;
    const previous = document.activeElement as HTMLElement | null;
    if (!dialog) return;
    dialog.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') return dismiss();
      if (event.key !== 'Tab') return;
      containFocus(event, dialog);
    };
    document.addEventListener('keydown', keydown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', keydown);
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, [dialogRef, dismiss]);
}

function containFocus(event: KeyboardEvent, dialog: HTMLElement) {
  const controls = dialog.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]',
  );
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function stepState(step: number, current: number): string {
  if (step === current) return 'current';
  return step < current ? 'complete' : 'pending';
}
