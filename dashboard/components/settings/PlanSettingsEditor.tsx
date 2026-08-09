"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { isAddress, zeroAddress, type Address } from "viem";
import { usePublicClient, useSignTypedData, useWriteContract } from "wagmi";
import { useApplication } from "@/components/shell/ApplicationShell";
import { TelegramLinkPanel } from "@/components/telegram/TelegramLinkPanel";
import {
  buildConfigurationRequest,
  submitConfiguration,
  type VerifiedConfigurationResponse,
} from "@/lib/configuration-client";
import type {
  ConfigurationAction,
  ConfigurationPayload,
  VerifiedConfigurationEvidence,
} from "@/lib/configuration-route";
import { legacyKeeperAbi } from "@/lib/contract";
import { configurationTypedData } from "@/lib/intent-signer";
import { randomNonce } from "@/lib/plan-client";
import { shortAddress } from "@/lib/format";

const DAY = 86_400;
const SEPOLIA = 11_155_111;
const STOP_PLAN_CONFIRMATION = "STOP";
type Section = "beneficiaries" | "liveness" | "recovery" | "trackedTokens";
const SECTIONS: readonly {
  value: Section;
  title: string;
  description: string;
}[] = [
  {
    value: "beneficiaries",
    title: "Beneficiaries",
    description: "Wallets and percentage allocation",
  },
  {
    value: "liveness",
    title: "Timing",
    description: "Check-in, inactivity, and grace windows",
  },
  {
    value: "recovery",
    title: "Recovery",
    description: "Required signer and emergency sweep vault",
  },
  {
    value: "trackedTokens",
    title: "Assets",
    description: "Non-custodial ERC-20 tracking",
  },
];

type Entry = { address: string; sharePercent: number };
type SettingsView =
  | { kind: "edit"; section: Section }
  | { kind: "review" }
  | { kind: "delete" }
  | null;

interface SettingsDraft {
  beneficiaries: Entry[];
  heartbeatDays: number;
  timeoutDays: number;
  graceDays: number;
  recoveryKey: string;
  safeVault: string;
  allowSharedRecovery: boolean;
  tokens: string[];
}

export function PlanSettingsEditor() {
  const app = useApplication();
  const plan =
    app.resolution.status === "resolved" ? app.resolution.plan : undefined;
  const [view, setView] = useState<SettingsView>(null);
  const [draft, setDraft] = useState(() => draftFrom(app.keeper));
  const [notice, setNotice] = useState<SettingsNotice>();
  const [disabledNotice, setDisabledNotice] = useState(false);
  const close = useCallback(() => setView(null), []);
  const onVerified = useCallback(
    (section: Section, evidence: VerifiedConfigurationResponse) => {
      setNotice({ section, evidence });
      setView(null);
    },
    [],
  );

  const launch = (next: Section) => {
    setDraft(draftFrom(app.keeper));
    setView({ kind: "edit", section: next });
  };
  if (!plan || !app.address) return null;

  return (
    <>
      {notice && (
        <SettingsSuccessNotice
          notice={notice}
          dismiss={() => setNotice(undefined)}
        />
      )}
      {disabledNotice && (
        <PlanDisabledNotice dismiss={() => setDisabledNotice(false)} />
      )}
      <SettingsRegister
        app={app}
        launch={launch}
        review={() => setView({ kind: "review" })}
        deletePlan={() => setView({ kind: "delete" })}
      />
      {view?.kind === "edit" && (
        <SettingsDialog
          context={{ app, plan, section: view.section, draft }}
          actions={{ setDraft, close, onVerified }}
        />
      )}
      {view?.kind === "review" && (
        <PlanReviewDialog app={app} launch={launch} close={close} />
      )}
      {view?.kind === "delete" && (
        <DeletePlanDialog
          context={{ app, plan }}
          actions={{
            close,
            onDeleted: () => {
              setDisabledNotice(true);
              setView(null);
            },
          }}
        />
      )}
    </>
  );
}

type Application = ReturnType<typeof useApplication>;

interface SettingsNotice {
  section: Section;
  evidence: VerifiedConfigurationResponse;
}

function SettingsSuccessNotice({
  notice,
  dismiss,
}: {
  notice: SettingsNotice;
  dismiss: () => void;
}) {
  return (
    <section className="settings-success" role="status" aria-live="polite">
      <span className="settings-success-mark" aria-hidden="true">
        ✓
      </span>
      <div>
        <h2>{sectionTitle(notice.section)} updated successfully</h2>
        <p>
          Verified on Sepolia · {shortAddress(notice.evidence.txHash, 8, 6)}.{" "}
          {telegramDeliveryMessage(notice.evidence.notification)}
        </p>
      </div>
      <button
        type="button"
        className="icon-button"
        aria-label="Dismiss update confirmation"
        onClick={dismiss}
      >
        ×
      </button>
    </section>
  );
}

function SettingsRegister({
  app,
  launch,
  review,
  deletePlan,
}: {
  app: Application;
  launch: (section: Section) => void;
  review: () => void;
  deletePlan: () => void;
}) {
  return (
    <>
      <section
        className="settings-register"
        aria-labelledby="configuration-title"
      >
        <header className="settings-register-head">
          <div>
            <span className="section-label">Live configuration</span>
            <h2 id="configuration-title">Plan settings</h2>
          </div>
          <span className="settings-register-state">4 signed policies</span>
        </header>
        {SECTIONS.map((item) => (
          <SettingsRegisterRow
            key={item.value}
            item={item}
            app={app}
            launch={launch}
          />
        ))}
      </section>
      <AdvancedSettings review={review} />
      <TelegramLinkPanel />
      <DeletePlanSection
        active={app.keeper.livenessActive}
        deletePlan={deletePlan}
      />
    </>
  );
}

function PlanDisabledNotice({ dismiss }: { dismiss: () => void }) {
  return (
    <section className="settings-success" role="status" aria-live="polite">
      <span className="settings-success-mark" aria-hidden="true">
        ✓
      </span>
      <div>
        <h2>Plan monitoring disabled</h2>
        <p>The confirmed Sepolia transaction stopped liveness monitoring.</p>
      </div>
      <button
        type="button"
        className="icon-button"
        aria-label="Dismiss stop confirmation"
        onClick={dismiss}
      >
        ×
      </button>
    </section>
  );
}

function DeletePlanSection({
  active,
  deletePlan,
}: {
  active: boolean;
  deletePlan: () => void;
}) {
  return (
    <section className="settings-danger-zone" aria-labelledby="delete-title">
      <div>
        <span className="section-label">Danger zone</span>
        <h2 id="delete-title">Stop this plan</h2>
        <p>
          Stop liveness monitoring and prevent this plan from becoming eligible
          for inheritance while disabled.
        </p>
      </div>
      <button
        type="button"
        className="danger-button"
        disabled={!active}
        onClick={deletePlan}
      >
        {active ? "Stop plan" : "Plan disabled"}
      </button>
    </section>
  );
}

interface DeletePlanContext {
  app: Application;
  plan: Address;
}

interface DeletePlanActions {
  close: () => void;
  onDeleted: () => void;
}

function DeletePlanDialog({
  context,
  actions,
}: {
  context: DeletePlanContext;
  actions: DeletePlanActions;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const [confirmation, setConfirmation] = useState("");
  const deletion = useDeletePlan(context, actions.onDeleted);
  const confirmed = confirmation === STOP_PLAN_CONFIRMATION;
  useSettingsDialog(dialog, actions.close);

  return (
    <div className="settings-backdrop">
      <div
        className="settings-dialog settings-delete-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        ref={dialog}
        tabIndex={-1}
      >
        <SettingsDialogHeader
          eyebrow="Danger zone"
          title="Stop this plan?"
          close={actions.close}
        />
        <DeletePlanConfirmation
          confirmation={confirmation}
          setConfirmation={setConfirmation}
        />
        <DeletePlanFooter
          confirmed={confirmed}
          deletion={deletion}
          close={actions.close}
        />
      </div>
    </div>
  );
}

function DeletePlanConfirmation({
  confirmation,
  setConfirmation,
}: {
  confirmation: string;
  setConfirmation: (value: string) => void;
}) {
  return (
    <div className="settings-dialog-body delete-plan-copy">
      <p>
        This disables liveness monitoring and prevents inheritance from becoming
        eligible while the plan is disabled.
      </p>
      <p>
        Blockchain history and the factory registration remain onchain. This
        action does not erase past transactions.
      </p>
      <label className="form-field">
        <span>
          Type <strong>{STOP_PLAN_CONFIRMATION}</strong> to confirm
        </span>
        <input
          value={confirmation}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setConfirmation(event.target.value)}
        />
      </label>
    </div>
  );
}

type DeletePlanState = ReturnType<typeof useDeletePlan>;

function DeletePlanFooter({
  confirmed,
  deletion,
  close,
}: {
  confirmed: boolean;
  deletion: DeletePlanState;
  close: () => void;
}) {
  return (
    <footer className="settings-dialog-foot delete-plan-actions">
      <div className="settings-result" role="status" aria-live="polite">
        {deletion.message}
      </div>
      <div className="confirm-actions">
        <button type="button" className="secondary" onClick={close}>
          Cancel
        </button>
        <button
          type="button"
          className="danger-button"
          disabled={!confirmed || deletion.pending}
          aria-busy={deletion.pending}
          onClick={deletion.deletePlan}
        >
          {deletion.pending ? "Stopping plan…" : "Stop plan"}
        </button>
      </div>
    </footer>
  );
}

function useDeletePlan(context: DeletePlanContext, onDeleted: () => void) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const publicClient = usePublicClient({ chainId: SEPOLIA });
  const { writeContractAsync } = useWriteContract();
  const wrongNetwork = context.app.chainId !== SEPOLIA;

  async function deletePlan() {
    if (wrongNetwork) {
      context.app.switchToSepolia();
      return;
    }
    if (!publicClient) {
      setError("Sepolia is unavailable. Try again in a moment.");
      return;
    }
    setPending(true);
    setError("");
    try {
      const hash = await writeContractAsync({
        address: context.plan,
        abi: legacyKeeperAbi,
        functionName: "toggleLiveness",
        args: [false],
      });
      await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
      await context.app.keeper.refetch();
      onDeleted();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Stopping the plan failed.",
      );
    } finally {
      setPending(false);
    }
  }

  return {
    deletePlan,
    pending,
    message: wrongNetwork ? "Switch to Sepolia to stop this plan." : error,
  };
}

function SettingsRegisterRow({
  item,
  app,
  launch,
}: {
  item: (typeof SECTIONS)[number];
  app: Application;
  launch: (section: Section) => void;
}) {
  return (
    <article className="settings-register-row">
      <span className="settings-register-icon" aria-hidden="true">
        <SettingsIcon section={item.value} />
      </span>
      <div className="settings-register-copy">
        <h3>{item.title}</h3>
        <p>{item.description}</p>
      </div>
      <div className="settings-register-value">
        <strong>{registerSummary(item.value, app)}</strong>
        <span>{signerRequirement(item.value, app)}</span>
      </div>
      <button
        type="button"
        className="settings-edit-button"
        aria-label={`Edit ${item.title} settings`}
        onClick={() => launch(item.value)}
      >
        Edit
      </button>
    </article>
  );
}

function SettingsIcon({ section }: { section: Section }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
    >
      {settingsIconGlyph(section)}
    </svg>
  );
}

function settingsIconGlyph(section: Section): ReactNode {
  if (section === "beneficiaries") {
    return (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <circle cx="12" cy="12" r="3" />
      </>
    );
  }
  if (section === "liveness") {
    return (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5v5l3.5 2" />
      </>
    );
  }
  if (section === "recovery") {
    return <path d="M12 3.5 20.5 12 12 20.5 3.5 12 12 3.5Z" />;
  }
  return <path d="m12 3.5 7.5 4.25v8.5L12 20.5l-7.5-4.25v-8.5L12 3.5Z" />;
}

function AdvancedSettings({ review }: { review: () => void }) {
  return (
    <section className="settings-advanced" aria-labelledby="advanced-title">
      <div>
        <span className="section-label">Advanced plan changes</span>
        <h2 id="advanced-title">Review the complete policy.</h2>
        <p>
          Inspect every live value together before choosing a focused signed
          update.
        </p>
      </div>
      <button type="button" className="secondary" onClick={review}>
        Review full plan
      </button>
    </section>
  );
}

function registerSummary(section: Section, app: Application): string {
  if (section === "beneficiaries") {
    return `${app.keeper.beneficiaries.length} wallets · ${app.keeper.totalShareBps / 100}%`;
  }
  if (section === "liveness") {
    return `${formatDays(app.keeper.timeoutDuration)} + ${formatDays(app.keeper.gracePeriod)}`;
  }
  if (section === "recovery") {
    return shortAddress(app.keeper.safeVault, 8, 6);
  }
  return `${app.keeper.trackedTokens.length} tracked tokens`;
}

function signerRequirement(section: Section, app: Application): string {
  if (section === "recovery" && app.keeper.recoveryKeyRegistered) {
    return `Required signer · ${shortAddress(app.keeper.recoveryKey, 6, 4)}`;
  }
  return "Required signer · plan owner";
}

function formatDays(seconds: number): string {
  if (!seconds) return "Not set";
  return `${Math.round(seconds / DAY)} days`;
}

interface DialogContext {
  app: ReturnType<typeof useApplication>;
  plan: Address;
  section: Section;
  draft: SettingsDraft;
}

interface DialogActions {
  setDraft: (draft: SettingsDraft) => void;
  close: () => void;
  onVerified: (
    section: Section,
    evidence: VerifiedConfigurationResponse,
  ) => void;
}

function SettingsDialog({
  context,
  actions,
}: {
  context: DialogContext;
  actions: DialogActions;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  useSettingsDialog(dialog, actions.close);
  return (
    <div className="settings-backdrop">
      <div
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        ref={dialog}
        tabIndex={-1}
      >
        <SettingsDialogHeader
          eyebrow="Signed plan update"
          title={`Edit ${sectionTitle(context.section)}`}
          close={actions.close}
        />
        <SettingsForm
          context={context}
          setDraft={actions.setDraft}
          onVerified={actions.onVerified}
        />
      </div>
    </div>
  );
}

function SettingsDialogHeader({
  eyebrow,
  title,
  close,
}: {
  eyebrow: string;
  title: string;
  close: () => void;
}) {
  return (
    <header className="settings-dialog-head">
      <div>
        <span className="section-label">{eyebrow}</span>
        <h2 id="settings-dialog-title">{title}</h2>
      </div>
      <button
        type="button"
        className="icon-button"
        aria-label="Close settings"
        onClick={close}
      >
        ×
      </button>
    </header>
  );
}

function PlanReviewDialog({
  app,
  launch,
  close,
}: {
  app: Application;
  launch: (section: Section) => void;
  close: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  useSettingsDialog(dialog, close);
  return (
    <div className="settings-backdrop">
      <div
        className="settings-dialog settings-review-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        ref={dialog}
        tabIndex={-1}
      >
        <SettingsDialogHeader
          eyebrow="Full plan review"
          title="Review live configuration"
          close={close}
        />
        <div className="settings-dialog-body settings-review-list">
          <p className="settings-review-intro">
            Each policy is authorized and verified independently through
            KeeperHub.
          </p>
          {SECTIONS.map((item) => (
            <PlanReviewRow
              key={item.value}
              item={item}
              app={app}
              launch={launch}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function PlanReviewRow({
  item,
  app,
  launch,
}: {
  item: (typeof SECTIONS)[number];
  app: Application;
  launch: (section: Section) => void;
}) {
  return (
    <article>
      <div>
        <h3>{item.title}</h3>
        <p>{registerSummary(item.value, app)}</p>
        <span>{signerRequirement(item.value, app)}</span>
      </div>
      <button
        type="button"
        className="settings-edit-button"
        onClick={() => launch(item.value)}
      >
        Edit
      </button>
    </article>
  );
}

function SettingsForm(props: {
  context: DialogContext;
  setDraft: (draft: SettingsDraft) => void;
  onVerified: DialogActions["onVerified"];
}) {
  const { context, setDraft, onVerified } = props;
  const validation = validateSection(
    context.section,
    context.draft,
    context.app.address,
  );
  const signer = expectedSigner(context);
  const submission = useSettingsSubmission(context, signer, onVerified);

  return (
    <>
      <SettingsPanel context={context} signer={signer} setDraft={setDraft} />
      <SettingsFooter
        view={{
          section: context.section,
          validation,
          wrongNetwork: context.app.chainId !== SEPOLIA,
          submission,
        }}
      />
    </>
  );
}

function SettingsPanel(props: {
  context: DialogContext;
  signer: Address;
  setDraft: (draft: SettingsDraft) => void;
}) {
  const { context } = props;
  return (
    <div className="settings-dialog-body">
      <SectionEditor
        section={context.section}
        draft={context.draft}
        setDraft={props.setDraft}
      />
      <SignerNotice
        action={context.section}
        signer={props.signer}
        owner={context.app.address}
      />
    </div>
  );
}

type SubmissionState = ReturnType<typeof useSettingsSubmission>;

function SettingsFooter({
  view,
}: {
  view: {
    section: Section;
    validation: string;
    wrongNetwork: boolean;
    submission: SubmissionState;
  };
}) {
  const message =
    view.submission.error ||
    view.validation ||
    (view.wrongNetwork ? "Switch to Sepolia to sign this update." : "") ||
    successMessage(view.submission.evidence);
  return (
    <footer className="settings-dialog-foot">
      <div className="settings-result" aria-live="polite">
        {message}
      </div>
      <button
        type="button"
        className="primary compact"
        disabled={
          Boolean(view.validation) ||
          view.submission.saving ||
          view.wrongNetwork
        }
        aria-busy={view.submission.saving}
        onClick={view.submission.save}
      >
        {saveLabel(view.section, view.submission.saving)}
      </button>
    </footer>
  );
}

function useSettingsSubmission(
  context: DialogContext,
  signer: Address,
  onVerified: DialogActions["onVerified"],
) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [evidence, setEvidence] = useState<VerifiedConfigurationEvidence>();
  const { signTypedDataAsync } = useSignTypedData();
  useEffect(() => {
    setError("");
    setEvidence(undefined);
  }, [context.section]);
  const save = async () => {
    setSaving(true);
    setError("");
    setEvidence(undefined);
    try {
      const unsigned = unsignedRequest(context);
      const signature = await signIntent(unsigned, signer, signTypedDataAsync);
      const verified = await submitConfiguration({ ...unsigned, signature });
      setEvidence(verified);
      void context.app.keeper.refetch();
      onVerified(context.section, verified);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Plan update failed.");
    } finally {
      setSaving(false);
    }
  };
  return { saving, error, evidence, save };
}

function SectionEditor(props: {
  section: Section;
  draft: SettingsDraft;
  setDraft: (draft: SettingsDraft) => void;
}) {
  if (props.section === "beneficiaries")
    return <BeneficiaryEditor {...props} />;
  if (props.section === "liveness") return <TimingEditor {...props} />;
  if (props.section === "recovery") return <RecoveryEditor {...props} />;
  return <AssetEditor {...props} />;
}

function BeneficiaryEditor(props: {
  draft: SettingsDraft;
  setDraft: (draft: SettingsDraft) => void;
}) {
  const update = (index: number, patch: Partial<Entry>) =>
    props.setDraft({
      ...props.draft,
      beneficiaries: props.draft.beneficiaries.map((entry, position) =>
        position === index ? { ...entry, ...patch } : entry,
      ),
    });
  return (
    <section className="settings-section">
      <EditorIntro
        title="Beneficiaries & allocation"
        body="Use 1–10 unique wallets. Allocation must total exactly 100%."
      />
      {props.draft.beneficiaries.map((entry, index) => (
        <div className="settings-entry" key={`${index}-${entry.address}`}>
          <TextInput
            label={`Beneficiary ${index + 1} wallet`}
            value={entry.address}
            onChange={(address) => update(index, { address })}
          />
          <NumberInput
            label="Allocation %"
            value={entry.sharePercent}
            onChange={(sharePercent) => update(index, { sharePercent })}
          />
          <button
            className="icon-button"
            aria-label={`Remove beneficiary ${index + 1}`}
            onClick={() =>
              props.setDraft({
                ...props.draft,
                beneficiaries: props.draft.beneficiaries.filter(
                  (_, position) => position !== index,
                ),
              })
            }
          >
            ×
          </button>
        </div>
      ))}
      <button
        className="secondary compact"
        disabled={props.draft.beneficiaries.length >= 10}
        onClick={() =>
          props.setDraft({
            ...props.draft,
            beneficiaries: [
              ...props.draft.beneficiaries,
              { address: "", sharePercent: 0 },
            ],
          })
        }
      >
        + Add beneficiary
      </button>
    </section>
  );
}

function TimingEditor(props: {
  draft: SettingsDraft;
  setDraft: (draft: SettingsDraft) => void;
}) {
  const set = (patch: Partial<SettingsDraft>) =>
    props.setDraft({ ...props.draft, ...patch });
  return (
    <section className="settings-section">
      <EditorIntro
        title="Liveness timing"
        body="Change how often check-ins are expected and how long recovery waits."
      />
      <div className="settings-field-grid">
        <NumberInput
          label="Check-in interval (days)"
          value={props.draft.heartbeatDays}
          onChange={(heartbeatDays) => set({ heartbeatDays })}
        />
        <NumberInput
          label="Inactivity window (days)"
          value={props.draft.timeoutDays}
          onChange={(timeoutDays) => set({ timeoutDays })}
        />
        <NumberInput
          label="Grace period (days)"
          value={props.draft.graceDays}
          onChange={(graceDays) => set({ graceDays })}
        />
      </div>
    </section>
  );
}

function RecoveryEditor(props: {
  draft: SettingsDraft;
  setDraft: (draft: SettingsDraft) => void;
}) {
  const set = (patch: Partial<SettingsDraft>) =>
    props.setDraft({ ...props.draft, ...patch });
  return (
    <section className="settings-section">
      <EditorIntro
        title="Recovery authority"
        body="A configured recovery signer must authorize any later replacement."
      />
      <TextInput
        label="Recovery signer wallet"
        value={props.draft.recoveryKey}
        onChange={(recoveryKey) => set({ recoveryKey })}
      />
      <TextInput
        label="Emergency sweep vault"
        value={props.draft.safeVault}
        onChange={(safeVault) => set({ safeVault })}
      />
      <label className="check-row">
        <input
          type="checkbox"
          checked={props.draft.allowSharedRecovery}
          onChange={(event) =>
            set({ allowSharedRecovery: event.target.checked })
          }
        />
        <span>
          Allow the recovery signer and sweep vault to be the same wallet.
        </span>
      </label>
    </section>
  );
}

function AssetEditor(props: {
  draft: SettingsDraft;
  setDraft: (draft: SettingsDraft) => void;
}) {
  const update = (index: number, address: string) =>
    props.setDraft({
      ...props.draft,
      tokens: props.draft.tokens.map((token, position) =>
        position === index ? address : token,
      ),
    });
  return (
    <section className="settings-section">
      <EditorIntro
        title="Tracked ERC-20 assets"
        body="Tracking does not move tokens. Allowance or permit readiness remains required."
      />
      {props.draft.tokens.map((token, index) => (
        <div className="settings-entry asset-setting" key={`${index}-${token}`}>
          <TextInput
            label={`Token ${index + 1} contract`}
            value={token}
            onChange={(address) => update(index, address)}
          />
          <button
            className="icon-button"
            aria-label={`Remove token ${index + 1}`}
            onClick={() =>
              props.setDraft({
                ...props.draft,
                tokens: props.draft.tokens.filter(
                  (_, position) => position !== index,
                ),
              })
            }
          >
            ×
          </button>
        </div>
      ))}
      <button
        className="secondary compact"
        onClick={() =>
          props.setDraft({
            ...props.draft,
            tokens: [...props.draft.tokens, ""],
          })
        }
      >
        + Add token
      </button>
    </section>
  );
}

function EditorIntro({ title, body }: { title: string; body: string }) {
  return (
    <header className="editor-intro">
      <h3>{title}</h3>
      <p>{body}</p>
    </header>
  );
}

function TextInput(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="form-field">
      <span>{props.label}</span>
      <input
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder="0x…"
        spellCheck={false}
      />
    </label>
  );
}

function NumberInput(props: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="form-field">
      <span>{props.label}</span>
      <input
        type="number"
        min="0"
        value={props.value}
        onChange={(event) => props.onChange(Number(event.target.value))}
      />
    </label>
  );
}

function SignerNotice(props: {
  action: Section;
  signer: Address;
  owner?: Address;
}) {
  const recovery = props.action === "recovery";
  const ownerSigns = props.signer.toLowerCase() === props.owner?.toLowerCase();
  return (
    <aside className="signer-notice">
      <span className="section-label">Required signer</span>
      <strong>{shortAddress(props.signer, 8, 6)}</strong>
      <p>
        {recovery && !ownerSigns
          ? "Your wallet may ask you to expose or select the current recovery account."
          : "The connected owner wallet authorizes this exact update."}
      </p>
    </aside>
  );
}

function draftFrom(
  keeper: ReturnType<typeof useApplication>["keeper"],
): SettingsDraft {
  return {
    beneficiaries: keeper.beneficiaries.map(({ wallet, shareBps }) => ({
      address: wallet,
      sharePercent: shareBps / 100,
    })),
    heartbeatDays: secondsToDays(keeper.heartbeatInterval),
    timeoutDays: secondsToDays(keeper.timeoutDuration),
    graceDays: secondsToDays(keeper.gracePeriod),
    recoveryKey: keeper.recoveryKey ?? "",
    safeVault: keeper.safeVault ?? "",
    allowSharedRecovery: Boolean(
      keeper.recoveryKey &&
      keeper.recoveryKey.toLowerCase() === keeper.safeVault?.toLowerCase(),
    ),
    tokens: keeper.trackedTokens,
  };
}

function validateSection(
  section: Section,
  draft: SettingsDraft,
  owner?: Address,
): string {
  if (section === "beneficiaries") return beneficiaryError(draft.beneficiaries);
  if (section === "liveness") return timingError(draft);
  if (section === "recovery") return recoveryError(draft, owner);
  return tokenError(draft.tokens);
}

function beneficiaryError(entries: Entry[]): string {
  if (entries.length < 1 || entries.length > 10)
    return "Add between 1 and 10 beneficiaries.";
  if (entries.some(({ address }) => !validAddress(address)))
    return "Every beneficiary needs a valid nonzero wallet.";
  if (
    new Set(entries.map(({ address }) => address.toLowerCase())).size !==
    entries.length
  )
    return "Beneficiary wallets must be unique.";
  if (
    entries.some(
      ({ sharePercent }) => !Number.isFinite(sharePercent) || sharePercent <= 0,
    )
  )
    return "Every allocation must be greater than 0%.";
  if (entries.some(({ sharePercent }) => !Number.isInteger(sharePercent * 100)))
    return "Use no more than two decimal places per allocation.";
  return entries.reduce((sum, item) => sum + item.sharePercent, 0) === 100
    ? ""
    : "Allocations must total exactly 100%.";
}

function timingError(draft: SettingsDraft): string {
  const values = [draft.heartbeatDays, draft.timeoutDays, draft.graceDays];
  if (values.some((value) => !Number.isInteger(value) || value < 0))
    return "Timing values must be whole days.";
  if (draft.heartbeatDays < 1 || draft.timeoutDays < 1)
    return "Check-in interval and inactivity window must be at least one day.";
  return "";
}

function recoveryError(draft: SettingsDraft, owner?: Address): string {
  if (!validAddress(draft.recoveryKey) || !validAddress(draft.safeVault))
    return "Enter valid recovery and sweep wallet addresses.";
  if (
    [draft.recoveryKey, draft.safeVault].some(
      (value) => value.toLowerCase() === owner?.toLowerCase(),
    )
  )
    return "Recovery wallets must differ from the owner.";
  if (
    draft.recoveryKey.toLowerCase() === draft.safeVault.toLowerCase() &&
    !draft.allowSharedRecovery
  )
    return "A shared recovery wallet requires explicit acknowledgement.";
  return "";
}

function tokenError(tokens: string[]): string {
  if (tokens.some((token) => !validAddress(token)))
    return "Every tracked token needs a valid contract address.";
  return new Set(tokens.map((token) => token.toLowerCase())).size ===
    tokens.length
    ? ""
    : "Tracked token addresses must be unique.";
}

function unsignedRequest(context: DialogContext) {
  return buildConfigurationRequest(
    {
      chainId: context.app.chainId ?? 0,
      owner: context.app.address as Address,
      plan: context.plan,
      action: context.section,
      payload: payloadFor(context.section, context.draft),
    },
    randomNonce(crypto.getRandomValues(new Uint8Array(32))),
    Math.floor(Date.now() / 1_000),
  );
}

function payloadFor(
  section: Section,
  draft: SettingsDraft,
): ConfigurationPayload {
  if (section === "beneficiaries")
    return {
      wallets: draft.beneficiaries.map(({ address }) => address as Address),
      shares: draft.beneficiaries.map(({ sharePercent }) =>
        Math.round(sharePercent * 100),
      ),
    };
  if (section === "liveness")
    return {
      heartbeatInterval: draft.heartbeatDays * DAY,
      timeoutDuration: draft.timeoutDays * DAY,
      gracePeriod: draft.graceDays * DAY,
    };
  if (section === "recovery")
    return {
      recoveryKey: draft.recoveryKey as Address,
      safeVault: draft.safeVault as Address,
      allowSharedRecovery: draft.allowSharedRecovery,
    };
  return { tokens: draft.tokens as Address[] };
}

type Signer = ReturnType<typeof useSignTypedData>["signTypedDataAsync"];

async function signIntent(
  request: ReturnType<typeof unsignedRequest>,
  signer: Address,
  sign: Signer,
) {
  const data = configurationTypedData(request);
  switch (data.primaryType) {
    case "SetBeneficiaries":
      return sign({ ...data, account: signer });
    case "SetLivenessConfig":
      return sign({ ...data, account: signer });
    case "SetRecoveryConfig":
      return sign({ ...data, account: signer });
    case "SetTrackedTokens":
      return sign({ ...data, account: signer });
  }
}

function expectedSigner(context: DialogContext): Address {
  if (
    context.section === "recovery" &&
    context.app.keeper.recoveryKeyRegistered &&
    context.app.keeper.recoveryKey
  )
    return context.app.keeper.recoveryKey as Address;
  return context.app.address as Address;
}

function useSettingsDialog(
  ref: React.RefObject<HTMLDivElement | null>,
  close: () => void,
) {
  useEffect(() => {
    ref.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") return close();
      if (event.key !== "Tab" || !ref.current) return;
      const items = focusableElements(ref.current);
      const first = items[0];
      const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [close, ref]);
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  const selector =
    "button:not(:disabled), input:not(:disabled), select:not(:disabled)";
  return [...container.querySelectorAll<HTMLElement>(selector)];
}

function validAddress(value: string): boolean {
  return isAddress(value) && value.toLowerCase() !== zeroAddress;
}

function secondsToDays(seconds: number): number {
  return seconds ? Math.round(seconds / DAY) : 0;
}

function sectionLabel(section: ConfigurationAction): string {
  return sectionTitle(section as Section).toLowerCase();
}

function sectionTitle(section: Section): string {
  return SECTIONS.find((item) => item.value === section)?.title ?? "settings";
}

function saveLabel(section: Section, saving: boolean): string {
  return saving
    ? "Verifying update…"
    : `Review & sign ${sectionLabel(section)}`;
}

function successMessage(evidence?: VerifiedConfigurationEvidence): string {
  return evidence
    ? `Verified on Sepolia · ${shortAddress(evidence.txHash, 8, 6)}`
    : "";
}

function telegramDeliveryMessage(
  delivery?: VerifiedConfigurationResponse["notification"],
): string {
  if (delivery === "sent") return "Telegram notification sent.";
  if (delivery === "failed")
    return "Telegram delivery failed; the plan update is still verified.";
  if (delivery === "skipped") return "Telegram is not linked to this wallet.";
  return "Telegram delivery status is unavailable.";
}
