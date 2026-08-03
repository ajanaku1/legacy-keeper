const HEARTBEAT_DEADLINE_SECONDS = 300;

export interface HeartbeatMessage {
  nonce: bigint;
  deadline: bigint;
}

export function prepareHeartbeatMessage(
  randomBytes: Uint8Array,
  nowSeconds: number
): HeartbeatMessage {
  if (randomBytes.length !== 32) {
    throw new Error('Heartbeat nonce requires exactly 32 random bytes');
  }
  let nonce = 0n;
  for (const byte of randomBytes) nonce = (nonce << 8n) | BigInt(byte);
  return {
    nonce,
    deadline: BigInt(nowSeconds + HEARTBEAT_DEADLINE_SECONDS),
  };
}
