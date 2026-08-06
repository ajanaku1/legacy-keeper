export {};

declare global {
  interface Window {
    __legacyKeeperSawDisconnectedGate: boolean;
  }
}
