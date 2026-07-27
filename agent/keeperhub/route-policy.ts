/**
 * Route policy.
 *
 * Sponsorship and private routing are different things and are treated as
 * mutually exclusive here:
 *
 *   SPONSORED — KeeperHub pays the gas and the transaction goes through the
 *   public mempool. Right for heartbeats and inheritance, where the owner may
 *   have no funded wallet and there is nothing to conceal. Confirmed working
 *   on Sepolia (`"sponsored": true`).
 *
 *   PRIVATE — submitted through a non-public path so the transaction is not
 *   visible before inclusion. Right for evacuation, where the transaction
 *   itself broadcasts "these funds are moving, race me". A private path needs
 *   a funded sender; you cannot ask a sponsor to also hide the transaction
 *   unless the platform says it supports both, and ours has not.
 *
 * We therefore never label one execution as both. Until a private submission
 * is verified end to end, `PRIVATE` is a *requested* route, and the audit
 * ledger and UI say "requested", not "used".
 */

export type Route = 'sponsored' | 'private' | 'default';

export interface RouteDecision {
  route: Route;
  /** True only when the platform has confirmed the route was honoured. */
  confirmed: boolean;
  rationale: string;
  /** Extra args to merge into an execute_contract_call payload. */
  payload: Record<string, unknown>;
}

const ACTION_ROUTES: Record<string, Route> = {
  heartbeatBySig: 'sponsored',
  executeInheritance: 'sponsored',
  executeInheritanceERC20: 'sponsored',
  evacuate: 'private',
  evacuateToken: 'private',
  panicButton: 'private',
};

export function chooseRoute(action: string): RouteDecision {
  const route = ACTION_ROUTES[action] ?? 'default';

  switch (route) {
    case 'sponsored':
      return {
        route,
        confirmed: false, // set from the execution result, never assumed
        rationale:
          'Liveness and distribution are not secret. Sponsorship removes the ' +
          'requirement that an absent owner keep a funded wallet.',
        payload: {},
      };

    case 'private':
      return {
        route,
        confirmed: false,
        rationale:
          'An evacuation transaction announces that funds are moving. Private ' +
          'submission withholds it until inclusion. Requires a funded sender — ' +
          'sponsorship is deliberately not requested alongside it.',
        payload: {},
      };

    default:
      return {
        route,
        confirmed: false,
        rationale: 'No special route requested.',
        payload: {},
      };
  }
}

/**
 * Read back what actually happened. A route is only ever reported as used when
 * the execution result says so — an intended route is not evidence.
 */
export function confirmRoute(
  decision: RouteDecision,
  executionResult: { sponsored?: boolean; privateRoute?: boolean } | undefined
): RouteDecision {
  if (!executionResult) return decision;

  if (decision.route === 'sponsored') {
    return { ...decision, confirmed: executionResult.sponsored === true };
  }
  if (decision.route === 'private') {
    return { ...decision, confirmed: executionResult.privateRoute === true };
  }
  return decision;
}

/** Guard against ever describing one execution as both. */
export function assertRoutesExclusive(result: {
  sponsored?: boolean;
  privateRoute?: boolean;
}): void {
  if (result.sponsored === true && result.privateRoute === true) {
    throw new Error(
      'route policy violated: an execution reported both sponsored and private. ' +
        'These are distinct submission paths; presenting both would misdescribe ' +
        'what the platform did.'
    );
  }
}

export function describeRoute(d: RouteDecision): string {
  if (d.route === 'default') return 'standard submission';
  return d.confirmed
    ? `${d.route} (confirmed by KeeperHub)`
    : `${d.route} requested (not confirmed)`;
}
