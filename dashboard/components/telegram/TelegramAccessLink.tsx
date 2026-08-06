import Link from "next/link";

export type TelegramAccessVariant = "icon";

export function TelegramAccessLink({
  variant,
}: {
  variant: TelegramAccessVariant;
}) {
  return (
    <Link
      className={`telegram-access telegram-access-${variant}`}
      href="/settings#telegram-notifications"
      aria-label="Manage Telegram notifications"
    >
      <TelegramIcon />
    </Link>
  );
}

export function TelegramIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M20.7 3.4 2.9 10.3c-1.2.5-1.2 1.1-.2 1.4l4.6 1.4 1.7 5.3c.2.7.1.9.8.9.5 0 .8-.2 1-.4l2.2-2.1 4.7 3.5c.9.5 1.5.2 1.7-.8l3-14.2c.3-1.3-.5-1.9-1.7-1.4ZM8 12.8l10.7-6.7c.5-.3 1-.1.6.2l-8.8 8-.3 3.2L8 12.8Z"
      />
    </svg>
  );
}
