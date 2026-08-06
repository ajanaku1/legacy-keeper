import { isAddress } from 'viem';

export interface ActivityEntry extends Record<string, unknown> {
  executionKey: string;
  owner?: string;
  attempt?: number;
  timestamp?: string;
}

export interface ActivityPage {
  entries: ActivityEntry[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ActivityWriteEntry {
  id?: string;
  executionKey: string;
  owner: string;
  timestamp: Date;
  trigger: { type: string; source: string; detail?: string };
  action: string;
  keeperhubExecutionId?: string;
  txHash?: string;
  gasUsed?: string;
  outcome: 'success' | 'failed';
  error?: string;
  errorCode?: string;
}

export interface ActivityRepository {
  append(entry: ActivityWriteEntry): Promise<void>;
  listByOwner(owner: string, page: number, pageSize?: number): Promise<ActivityPage>;
}

export function parseAuditLedger(content: string): ActivityEntry[] {
  return content
    .split('\n')
    .filter(Boolean)
    .flatMap(parseEntry);
}

export function filterEntriesForOwner(
  entries: readonly ActivityEntry[],
  owner: string
): ActivityEntry[] {
  if (!isAddress(owner)) return [];
  const normalizedOwner = owner.toLowerCase();
  return entries.filter(
    (entry) => entryOwner(entry)?.toLowerCase() === normalizedOwner
  );
}

export function toPublicActivityEntries(
  entries: readonly ActivityEntry[]
): ActivityEntry[] {
  return entries.map((entry) => ({
    executionKey: entry.executionKey,
    attempt: entry.attempt,
    timestamp: entry.timestamp,
    trigger: entry.trigger,
    action: entry.action,
    txHash: entry.txHash,
    gasUsed: entry.gasUsed,
    outcome: entry.outcome,
    errorCode: entry.errorCode,
  }));
}

export function paginateActivityEntries(
  entries: readonly ActivityEntry[],
  requestedPage: number,
  pageSize = 5
): ActivityPage {
  const size = Number.isInteger(pageSize) && pageSize > 0 ? pageSize : 5;
  const sorted = [...entries].sort((a, b) =>
    (a.timestamp ?? '') < (b.timestamp ?? '') ? 1 : -1
  );
  const totalPages = Math.max(1, Math.ceil(sorted.length / size));
  const page = Math.min(
    totalPages,
    Math.max(1, Number.isInteger(requestedPage) ? requestedPage : 1)
  );
  const offset = (page - 1) * size;
  return {
    entries: sorted.slice(offset, offset + size),
    page,
    pageSize: size,
    total: sorted.length,
    totalPages,
  };
}

function parseEntry(line: string): ActivityEntry[] {
  try {
    const value: unknown = JSON.parse(line);
    if (!isRecord(value) || typeof value.executionKey !== 'string') return [];
    return [value as ActivityEntry];
  } catch {
    return [];
  }
}

export function entryOwner(entry: ActivityEntry): string | undefined {
  if (entry.owner && isAddress(entry.owner)) return entry.owner;
  const owner = entry.executionKey.split(':')[1];
  return owner && isAddress(owner) ? owner : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
