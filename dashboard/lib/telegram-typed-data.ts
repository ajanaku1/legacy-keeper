import type { Address } from "viem";

export interface LinkTelegramMessage {
  sessionId: string;
  owner: Address;
  chainId: number;
  telegramUserId: string;
  nonce: string;
  deadline: string;
}

export interface UnlinkTelegramMessage {
  linkId: string;
  owner: Address;
  chainId: number;
  nonce: string;
  deadline: string;
}

export interface TelegramActionMessage {
  action: "status" | "test";
  linkId: string;
  owner: Address;
  chainId: number;
  nonce: string;
  deadline: string;
}

export interface TelegramWalletAccessMessage {
  owner: Address;
  chainId: number;
  nonce: string;
  deadline: string;
}

const domain = (chainId: number) => ({
  name: "LegacyKeeper Telegram",
  version: "1",
  chainId,
});

export function telegramLinkTypedData(request: LinkTelegramMessage) {
  return {
    domain: domain(request.chainId),
    types: {
      LinkTelegram: [
        { name: "sessionId", type: "string" },
        { name: "telegramUserId", type: "string" },
        { name: "owner", type: "address" },
        { name: "chainId", type: "uint256" },
        { name: "nonce", type: "string" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "LinkTelegram" as const,
    message: {
      sessionId: request.sessionId,
      telegramUserId: request.telegramUserId,
      owner: request.owner,
      chainId: BigInt(request.chainId),
      nonce: request.nonce,
      deadline: BigInt(request.deadline),
    },
  } as const;
}

export function telegramUnlinkTypedData(request: UnlinkTelegramMessage) {
  return {
    domain: domain(request.chainId),
    types: {
      UnlinkTelegram: [
        { name: "linkId", type: "string" },
        { name: "owner", type: "address" },
        { name: "chainId", type: "uint256" },
        { name: "nonce", type: "string" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "UnlinkTelegram" as const,
    message: {
      linkId: request.linkId,
      owner: request.owner,
      chainId: BigInt(request.chainId),
      nonce: request.nonce,
      deadline: BigInt(request.deadline),
    },
  } as const;
}

export function telegramActionTypedData(request: TelegramActionMessage) {
  return {
    domain: domain(request.chainId),
    types: {
      TelegramAction: [
        { name: "action", type: "string" },
        { name: "linkId", type: "string" },
        { name: "owner", type: "address" },
        { name: "chainId", type: "uint256" },
        { name: "nonce", type: "string" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "TelegramAction" as const,
    message: {
      action: request.action,
      linkId: request.linkId,
      owner: request.owner,
      chainId: BigInt(request.chainId),
      nonce: request.nonce,
      deadline: BigInt(request.deadline),
    },
  } as const;
}

export function telegramWalletAccessTypedData(
  request: TelegramWalletAccessMessage,
) {
  return {
    domain: domain(request.chainId),
    types: {
      TelegramWalletAccess: [
        { name: "owner", type: "address" },
        { name: "chainId", type: "uint256" },
        { name: "nonce", type: "string" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "TelegramWalletAccess" as const,
    message: {
      owner: request.owner,
      chainId: BigInt(request.chainId),
      nonce: request.nonce,
      deadline: BigInt(request.deadline),
    },
  } as const;
}
