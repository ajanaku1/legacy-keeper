export interface TelegramAccessEnvironment {
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_BOT_USERNAME?: string;
}

type TelegramAccessFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<{
  ok: boolean;
  json: () => Promise<unknown>;
}>;

export async function resolveTelegramAccessUrl(
  environment: TelegramAccessEnvironment = runtimeEnvironment(),
  fetcher: TelegramAccessFetch = fetch,
): Promise<string | undefined> {
  const configured = telegramDeepLink(environment.TELEGRAM_BOT_USERNAME);
  if (configured) return configured;
  if (!environment.TELEGRAM_BOT_TOKEN) return undefined;

  try {
    const response = await fetcher(
      `https://api.telegram.org/bot${environment.TELEGRAM_BOT_TOKEN}/getMe`,
      { method: "GET", signal: AbortSignal.timeout(8_000) },
    );
    if (!response.ok) return undefined;
    return telegramDeepLink(usernameFrom(await response.json()));
  } catch {
    return undefined;
  }
}

function telegramDeepLink(username?: string): string | undefined {
  const normalized = username?.replace(/^@/, "");
  if (!normalized || !/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(normalized)) {
    return undefined;
  }
  return `https://t.me/${normalized}?start=notifications`;
}

function usernameFrom(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const payload = value as Record<string, unknown>;
  if (payload.ok !== true || !payload.result || typeof payload.result !== "object") {
    return undefined;
  }
  const username = (payload.result as Record<string, unknown>).username;
  return typeof username === "string" ? username : undefined;
}

function runtimeEnvironment(): TelegramAccessEnvironment {
  return {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_BOT_USERNAME: process.env.TELEGRAM_BOT_USERNAME,
  };
}
