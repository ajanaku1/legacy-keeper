import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

describe('activity pagination UI', () => {
  it('requests one five-record page and exposes newer and older controls', () => {
    const record = source('../components/ExecutionRecord.tsx');

    expect(record).toContain('page=${page}');
    expect(record).toContain('pageSize');
    expect(record).toContain('aria-label="Show newer activity"');
    expect(record).toContain('aria-label="Show older activity"');
    expect(record).toContain('Page {activity.page} of {activity.totalPages}');
  });

  it('shows an explicit retry state instead of a false empty ledger on storage failure', () => {
    const record = source('../components/ExecutionRecord.tsx');

    expect(record).toContain('Activity is temporarily unavailable.');
    expect(record).toContain('Retry activity');
    expect(record).toContain('query.refetch');
  });
});
