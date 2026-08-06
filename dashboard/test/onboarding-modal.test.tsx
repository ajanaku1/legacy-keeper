import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ONBOARDING_STEPS } from '../components/onboarding/OnboardingModal';

const modalSource = readFileSync(
  new URL('../components/onboarding/OnboardingModal.tsx', import.meta.url),
  'utf8'
);
const controllerSource = readFileSync(
  new URL('../components/onboarding/OnboardingController.tsx', import.meta.url),
  'utf8'
);
const shellSource = readFileSync(
  new URL('../components/shell/ApplicationShell.tsx', import.meta.url),
  'utf8'
);
const stylesSource = readFileSync(
  new URL('../app/globals.css', import.meta.url),
  'utf8'
);

describe('seven-step onboarding modal', () => {
  it('uses the approved sequence and marks asset setup optional', () => {
    expect(ONBOARDING_STEPS.map(({ label }) => label)).toEqual([
      'Welcome',
      'Timing',
      'Beneficiaries',
      'Recovery',
      'Assets',
      'Review & sign',
      'Verify',
    ]);
    expect(ONBOARDING_STEPS[4]?.optional).toBe(true);
  });

  it('is a dismissible, labelled dialog with focus containment', () => {
    expect(modalSource).toContain('role="dialog"');
    expect(modalSource).toContain('aria-modal="true"');
    expect(modalSource).toContain('aria-labelledby');
    expect(modalSource).toContain("event.key === 'Escape'");
    expect(modalSource).toContain("event.key !== 'Tab'");
    expect(modalSource).toMatch(/Close setup/i);
  });

  it('keeps every safety decision visible before signing', () => {
    expect(modalSource).toMatch(/beneficiar/i);
    expect(modalSource).toMatch(/recovery/i);
    expect(modalSource).toMatch(/optional/i);
    expect(modalSource).toMatch(/permit/i);
    expect(modalSource).toMatch(/native ETH/i);
    expect(modalSource).toMatch(/review/i);
    expect(modalSource).toMatch(/verify/i);
    expect(modalSource).not.toMatch(/private.?key/i);
  });

  it('signs once at review and advances only on verified plan evidence', () => {
    expect(modalSource).toMatch(/Sign and create plan/i);
    expect(modalSource).toMatch(/actions\.createPlan/);
    expect(modalSource).toMatch(/stage === 'verified'/);
    expect(modalSource).not.toMatch(/writeContract|sendTransaction/);
  });

  it('mounts over the routed shell and offers a persistent resume action', () => {
    expect(shellSource).toContain('<OnboardingController />');
    expect(controllerSource).toMatch(/Finish setup/i);
    expect(controllerSource).toContain('browserDraftStorage');
    expect(controllerSource).toMatch(/router\.replace\(['"]\/dashboard['"]\)/);
    expect(controllerSource).toMatch(/resolution\.status !== ["']missing["']/);
  });

  it('does not create a standalone onboarding route', () => {
    expect(
      existsSync(new URL('../app/onboarding/page.tsx', import.meta.url))
    ).toBe(false);
  });

  it('keeps one responsive modal height and scrolls only the step body', () => {
    expect(stylesSource).toMatch(
      /\.onboarding-modal\s*\{[^}]*height:\s*min\(820px,\s*calc\(100dvh\s*-\s*48px\)\)/s
    );
    expect(stylesSource).toMatch(
      /\.onboarding-body\s*\{[^}]*min-height:\s*0[^}]*overflow-y:\s*auto/s
    );
  });
});
