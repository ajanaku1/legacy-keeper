export interface DurationParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

export interface AdvancedTiming {
  inactivity: DurationParts;
  grace: DurationParts;
}

export interface TimingSeconds {
  heartbeat: number;
  timeout: number;
  grace: number;
}

export const ADVANCED_HEARTBEAT_SECONDS = 1;

const MINUTE = 60;
const HOUR = 3_600;
const DAY = 86_400;

export function timingSeconds(timing: AdvancedTiming): TimingSeconds {
  return {
    heartbeat: ADVANCED_HEARTBEAT_SECONDS,
    timeout: durationSeconds(timing.inactivity),
    grace: durationSeconds(timing.grace),
  };
}

export function inheritanceDelaySeconds(timing: AdvancedTiming): number {
  const seconds = timingSeconds(timing);
  return seconds.timeout + seconds.grace;
}

export function validateAdvancedTiming(timing: AdvancedTiming): string {
  const parts = [
    ...Object.values(timing.inactivity),
    ...Object.values(timing.grace),
  ];
  if (parts.some((value) => !Number.isSafeInteger(value))) {
    return 'Advanced timing values must be whole numbers.';
  }
  if (parts.some((value) => value < 0)) {
    return 'Advanced timing values cannot be negative.';
  }
  if (timing.inactivity.hours > 23 || timing.grace.hours > 23) {
    return 'Hours must be between 0 and 23.';
  }
  if (timing.inactivity.minutes > 59 || timing.grace.minutes > 59) {
    return 'Minutes must be between 0 and 59.';
  }
  if (timing.inactivity.seconds > 59 || timing.grace.seconds > 59) {
    return 'Seconds must be between 0 and 59.';
  }
  const inactivity = durationSeconds(timing.inactivity);
  const grace = durationSeconds(timing.grace);
  if (!Number.isSafeInteger(inactivity) || !Number.isSafeInteger(grace)) {
    return 'Advanced timing duration is too large.';
  }
  if (inactivity < 1) {
    return 'Inactivity must be at least one second.';
  }
  if (!Number.isSafeInteger(inactivity + grace)) {
    return 'Inheritance timing duration is too large.';
  }
  return '';
}

export function advancedTimingFromSeconds(
  timeout: number,
  grace: number,
): AdvancedTiming {
  return {
    inactivity: durationParts(timeout),
    grace: durationParts(grace),
  };
}

export function formatPlanDuration(seconds: number): string {
  const parts = durationParts(seconds);
  const labels = [
    durationLabel(parts.days, 'day'),
    durationLabel(parts.hours, 'hour'),
    durationLabel(parts.minutes, 'minute'),
    durationLabel(parts.seconds, 'second'),
  ].filter(Boolean);
  return labels.length > 0 ? labels.join(' ') : '0 seconds';
}

export function timingInputValue(value: number): string {
  return value === 0 ? '' : String(value);
}

export function parseTimingInput(value: string): number | null {
  if (!/^\d*$/.test(value)) return null;
  return value === '' ? 0 : Number(value);
}

function durationSeconds(duration: DurationParts): number {
  return (
    duration.days * DAY +
    duration.hours * HOUR +
    duration.minutes * MINUTE +
    duration.seconds
  );
}

function durationParts(seconds: number): DurationParts {
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  return {
    days: Math.floor(wholeSeconds / DAY),
    hours: Math.floor((wholeSeconds % DAY) / HOUR),
    minutes: Math.floor((wholeSeconds % HOUR) / MINUTE),
    seconds: wholeSeconds % MINUTE,
  };
}

function durationLabel(value: number, unit: string): string {
  return value === 0 ? '' : `${value} ${unit}${value === 1 ? '' : 's'}`;
}
