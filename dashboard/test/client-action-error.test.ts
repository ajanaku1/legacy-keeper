import { describe, expect, it } from 'vitest';
import { userFacingActionError } from '../lib/client-action-error';

describe('client action errors', () => {
  it('maps stable API codes to a concrete user remedy', () => {
    expect(
      userFacingActionError(
        { code: 'WRONG_NETWORK', error: 'internal detail' },
        'fallback'
      )
    ).toBe('Switch to Sepolia, review the request, and try again.');
    expect(
      userFacingActionError(
        { code: 'SIGNATURE_EXPIRED', error: 'internal detail' },
        'fallback'
      )
    ).toMatch(/sign a new attempt/i);
  });

  it('uses a safe fallback for unknown response shapes', () => {
    expect(userFacingActionError({ error: 'provider stack trace' }, 'Try again.')).toBe(
      'Try again.'
    );
  });
});
