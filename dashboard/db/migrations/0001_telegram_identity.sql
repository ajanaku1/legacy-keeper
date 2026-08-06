CREATE TABLE "telegram_accounts" (
  "telegram_user_id" text PRIMARY KEY,
  "private_chat_id" text NOT NULL,
  "username" text,
  "first_name" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "telegram_wallet_links" (
  "id" text PRIMARY KEY,
  "chain_id" integer NOT NULL,
  "owner" text NOT NULL,
  "plan" text NOT NULL,
  "telegram_user_id" text NOT NULL REFERENCES "telegram_accounts"("telegram_user_id"),
  "linked_at" timestamptz NOT NULL DEFAULT now(),
  "revoked_at" timestamptz,
  CONSTRAINT "telegram_wallet_links_owner_lowercase" CHECK ("owner" = lower("owner"))
);

CREATE UNIQUE INDEX "telegram_wallet_links_active_wallet_unique"
  ON "telegram_wallet_links" ("chain_id", "owner")
  WHERE "revoked_at" IS NULL;
CREATE INDEX "telegram_wallet_links_active_account_idx"
  ON "telegram_wallet_links" ("telegram_user_id")
  WHERE "revoked_at" IS NULL;

CREATE TABLE "telegram_link_sessions" (
  "id" text PRIMARY KEY,
  "bot_token_hash" text NOT NULL UNIQUE,
  "browser_token_hash" text NOT NULL UNIQUE,
  "chain_id" integer NOT NULL,
  "owner" text NOT NULL,
  "telegram_user_id" text REFERENCES "telegram_accounts"("telegram_user_id"),
  "nonce" text NOT NULL,
  "deadline" text NOT NULL,
  "state" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "telegram_link_sessions_state_check"
    CHECK ("state" IN ('pending', 'detected', 'consumed', 'expired', 'cancelled')),
  CONSTRAINT "telegram_link_sessions_owner_lowercase" CHECK ("owner" = lower("owner"))
);

CREATE INDEX "telegram_link_sessions_expiry_idx"
  ON "telegram_link_sessions" ("expires_at");

CREATE TABLE "telegram_deliveries" (
  "id" text PRIMARY KEY,
  "idempotency_key" text NOT NULL UNIQUE,
  "source" text NOT NULL,
  "event_type" text NOT NULL,
  "chain_id" integer NOT NULL,
  "owner" text NOT NULL,
  "plan" text NOT NULL,
  "transaction_hash" text,
  "telegram_user_id" text REFERENCES "telegram_accounts"("telegram_user_id"),
  "private_chat_id" text,
  "attempt_count" integer NOT NULL DEFAULT 0,
  "status" text NOT NULL,
  "next_attempt_at" timestamptz,
  "last_error" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "delivered_at" timestamptz,
  CONSTRAINT "telegram_deliveries_status_check"
    CHECK ("status" IN ('pending', 'sent', 'failed', 'suppressed')),
  CONSTRAINT "telegram_deliveries_attempt_nonnegative" CHECK ("attempt_count" >= 0)
);

CREATE INDEX "telegram_deliveries_retry_idx"
  ON "telegram_deliveries" ("status", "next_attempt_at");
