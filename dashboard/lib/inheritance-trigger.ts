import { exactObject, requiredAddress } from "./action-validation";
import {
  runInheritancePlan,
  type InheritanceMonitorDependencies,
  type InheritanceMonitorResult,
  type RegisteredPlan,
} from "./inheritance-monitor";
import {
  runTokenInheritancePlan,
  type TokenInheritanceMonitorDependencies,
  type TokenInheritanceMonitorResult,
} from "./token-inheritance-monitor";

const REQUEST_FIELDS = ["owner", "plan"] as const;

export function parseInheritanceTriggerRequest(value: unknown): RegisteredPlan {
  const request = exactObject(
    value,
    REQUEST_FIELDS,
    "Inheritance trigger request",
  );
  return {
    owner: requiredAddress(request.owner, "owner"),
    plan: requiredAddress(request.plan, "plan"),
  };
}

export interface InheritanceTriggerResult {
  native: InheritanceMonitorResult;
  tokens: TokenInheritanceMonitorResult[];
}

export async function runInheritanceTrigger(
  registered: RegisteredPlan,
  nativeDependencies: InheritanceMonitorDependencies,
  tokenDependencies: TokenInheritanceMonitorDependencies,
): Promise<InheritanceTriggerResult> {
  const native = await runInheritancePlan(registered, nativeDependencies);
  const tokens = await runTokenInheritancePlan(registered, tokenDependencies);
  return { native, tokens };
}
