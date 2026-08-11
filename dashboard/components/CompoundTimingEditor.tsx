import {
  formatPlanDuration,
  inheritanceDelaySeconds,
  parseTimingInput,
  timingInputValue,
  type AdvancedTiming,
  type DurationParts,
} from '@/lib/timing';

interface CompoundTimingEditorProps {
  idPrefix: string;
  timing: AdvancedTiming;
  onChange: (timing: AdvancedTiming) => void;
}

type DurationKey = keyof DurationParts;

const UNITS: readonly { key: DurationKey; label: string; max?: number }[] = [
  { key: 'days', label: 'Days' },
  { key: 'hours', label: 'Hours', max: 23 },
  { key: 'minutes', label: 'Minutes', max: 59 },
  { key: 'seconds', label: 'Seconds', max: 59 },
];

export function CompoundTimingEditor(props: CompoundTimingEditorProps) {
  const update = (field: keyof AdvancedTiming, value: DurationParts) =>
    props.onChange({ ...props.timing, [field]: value });

  return (
    <div className="advanced-timing-panel">
      <DurationRow
        field={{
          idPrefix: `${props.idPrefix}-inactivity`,
          label: 'Inactivity',
          description: 'Time without a check-in before the grace period starts.',
          value: props.timing.inactivity,
          onChange: (value) => update('inactivity', value),
        }}
      />
      <DurationRow
        field={{
          idPrefix: `${props.idPrefix}-grace`,
          label: 'Grace period',
          description: 'Final delay before inheritance can execute.',
          value: props.timing.grace,
          onChange: (value) => update('grace', value),
        }}
      />
      <TimingSummary timing={props.timing} />
      <p className="advanced-timing-caution">
        Short durations are intended for controlled testing.
      </p>
    </div>
  );
}

function TimingSummary({ timing }: { timing: AdvancedTiming }) {
  return (
    <p className="advanced-timing-summary" aria-live="polite">
      <span>Inheritance eligible</span>
      <strong>
        {formatPlanDuration(inheritanceDelaySeconds(timing))} after the last
        check-in
      </strong>
    </p>
  );
}

interface DurationField {
  idPrefix: string;
  label: string;
  description: string;
  value: DurationParts;
  onChange: (value: DurationParts) => void;
}

function DurationRow({ field }: { field: DurationField }) {
  const labelId = `${field.idPrefix}-label`;
  return (
    <div className="duration-row" role="group" aria-labelledby={labelId}>
      <div className="duration-row-copy">
        <strong id={labelId}>{field.label}</strong>
        <span>{field.description}</span>
      </div>
      <div className="duration-inputs">
        {UNITS.map((unit) => (
          <DurationInput field={field} unit={unit} key={unit.key} />
        ))}
      </div>
    </div>
  );
}

function DurationInput({
  field,
  unit,
}: {
  field: DurationField;
  unit: (typeof UNITS)[number];
}) {
  const id = `${field.idPrefix}-${unit.key}`;
  return (
    <label className="duration-input" htmlFor={id}>
      <span>{unit.label}</span>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        value={timingInputValue(field.value[unit.key])}
        onChange={(event) => {
          const next = parseTimingInput(event.target.value);
          if (next === null) return;
          field.onChange({ ...field.value, [unit.key]: next });
        }}
        aria-label={`${field.label} ${unit.label.toLowerCase()}`}
        maxLength={unit.max === undefined ? 6 : 2}
      />
    </label>
  );
}
