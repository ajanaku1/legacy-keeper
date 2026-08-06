CREATE TABLE "activity_attempt_counters" (
  "execution_key" text PRIMARY KEY,
  "attempt_count" integer NOT NULL DEFAULT 0,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "activity_attempt_counters_nonnegative" CHECK ("attempt_count" >= 0)
);

CREATE TABLE "activity_entries" (
  "id" text PRIMARY KEY,
  "execution_key" text NOT NULL REFERENCES "activity_attempt_counters"("execution_key") ON DELETE CASCADE,
  "owner" text NOT NULL,
  "attempt" integer NOT NULL,
  "occurred_at" timestamptz NOT NULL,
  "trigger_type" text NOT NULL,
  "trigger_source" text NOT NULL,
  "trigger_detail" text,
  "action" text NOT NULL,
  "keeperhub_execution_id" text,
  "transaction_hash" text,
  "gas_used" text,
  "outcome" text NOT NULL,
  "error" text,
  "error_code" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "activity_entries_owner_lowercase" CHECK ("owner" = lower("owner")),
  CONSTRAINT "activity_entries_attempt_positive" CHECK ("attempt" > 0),
  CONSTRAINT "activity_entries_outcome_check" CHECK ("outcome" IN ('success', 'failed'))
);

CREATE UNIQUE INDEX "activity_entries_execution_attempt_unique"
  ON "activity_entries" ("execution_key", "attempt");
CREATE INDEX "activity_entries_owner_time_idx"
  ON "activity_entries" ("owner", "occurred_at" DESC);
