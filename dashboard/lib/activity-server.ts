import { getTelegramDatabase } from "../db/client";
import { createPostgresActivityRepository } from "./postgres-activity-repository";

export function serverActivityRepository() {
  return createPostgresActivityRepository(getTelegramDatabase());
}
