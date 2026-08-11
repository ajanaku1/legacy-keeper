import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const MONITOR_AUDIENCE = "legacy-keeper-inheritance-monitor";
const EXPECTED_CLAIMS = {
  repository: "ajanaku1/legacy-keeper",
  ref: "refs/heads/main",
  workflow_ref:
    "ajanaku1/legacy-keeper/.github/workflows/inheritance-monitor.yml@refs/heads/main",
} as const;
const GITHUB_KEYS = createRemoteJWKSet(
  new URL(`${GITHUB_OIDC_ISSUER}/.well-known/jwks`),
);

export type MonitorTokenVerifier = (token: string) => Promise<JWTPayload>;

export async function authorizeInheritanceMonitor(
  authorization: string | null,
  verifyToken: MonitorTokenVerifier = verifyGitHubToken,
): Promise<boolean> {
  const token = bearerToken(authorization);
  if (!token) return false;
  try {
    const claims = await verifyToken(token);
    return expectedWorkflowClaims(claims);
  } catch {
    return false;
  }
}

function expectedWorkflowClaims(claims: JWTPayload): boolean {
  const repository = String(claims.repository ?? "").toLowerCase();
  const workflow = String(claims.workflow_ref ?? "").toLowerCase();
  const event = String(claims.event_name ?? "");
  return (
    repository === EXPECTED_CLAIMS.repository &&
    claims.ref === EXPECTED_CLAIMS.ref &&
    workflow === EXPECTED_CLAIMS.workflow_ref &&
    ["schedule", "workflow_dispatch"].includes(event)
  );
}

async function verifyGitHubToken(token: string): Promise<JWTPayload> {
  const verified = await jwtVerify(token, GITHUB_KEYS, {
    issuer: GITHUB_OIDC_ISSUER,
    audience: MONITOR_AUDIENCE,
  });
  return verified.payload;
}

function bearerToken(authorization: string | null): string | undefined {
  const match = authorization?.match(/^Bearer ([^\s]+)$/);
  return match?.[1];
}
