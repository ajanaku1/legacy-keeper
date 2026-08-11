import { describe, expect, it } from 'vitest';
import {
  advancedTimingFromSeconds,
  formatPlanDuration,
  inheritanceDelaySeconds,
  parseTimingInput,
  timingInputValue,
  timingSeconds,
  validateAdvancedTiming,
} from '../lib/timing';

describe('advanced plan timing', () => {
  it('makes inheritance eligible after inactivity plus grace', () => {
    const timing = {
      inactivity: { days: 0, hours: 0, minutes: 10, seconds: 0 },
      grace: { days: 0, hours: 0, minutes: 5, seconds: 0 },
    };

    expect(timingSeconds(timing)).toEqual({
      heartbeat: 1,
      timeout: 600,
      grace: 300,
    });
    expect(inheritanceDelaySeconds(timing)).toBe(900);
  });

  it('rejects invalid duration parts without constraining grace to inactivity', () => {
    expect(
      validateAdvancedTiming({
        inactivity: { days: 0, hours: 0, minutes: 0, seconds: 0 },
        grace: { days: 0, hours: 0, minutes: 5, seconds: 0 },
      }),
    ).toMatch(/inactivity.*at least one second/i);
    expect(
      validateAdvancedTiming({
        inactivity: { days: 0, hours: 0, minutes: 10.5, seconds: 0 },
        grace: { days: 0, hours: 0, minutes: 5, seconds: 0 },
      }),
    ).toMatch(/whole/i);
    expect(
      validateAdvancedTiming({
        inactivity: { days: 0, hours: 24, minutes: 0, seconds: 0 },
        grace: { days: 0, hours: 0, minutes: 5, seconds: 0 },
      }),
    ).toMatch(/hours.*23/i);
    expect(
      validateAdvancedTiming({
        inactivity: { days: 0, hours: 0, minutes: 10, seconds: 0 },
        grace: { days: 0, hours: 0, minutes: 15, seconds: 0 },
      }),
    ).toBe('');
  });

  it('derives day, hour, and minute fields from contract seconds', () => {
    expect(advancedTimingFromSeconds(90_601, 3_902)).toEqual({
      inactivity: { days: 1, hours: 1, minutes: 10, seconds: 1 },
      grace: { days: 0, hours: 1, minutes: 5, seconds: 2 },
    });
  });

  it('renders zero as empty and rejects non-digit input', () => {
    expect(timingInputValue(0)).toBe('');
    expect(timingInputValue(12)).toBe('12');
    expect(parseTimingInput('')).toBe(0);
    expect(parseTimingInput('12')).toBe(12);
    expect(parseTimingInput('12x')).toBeNull();
  });

  it('formats sub-day and day durations without rounding them away', () => {
    expect(formatPlanDuration(300)).toBe('5 minutes');
    expect(formatPlanDuration(3_600)).toBe('1 hour');
    expect(formatPlanDuration(86_400)).toBe('1 day');
  });
});
