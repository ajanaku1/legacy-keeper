import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Serves the agent's real audit ledger. The dashboard renders whatever is in
 * this file and nothing else — if the agent has not run, the execution record
 * is empty rather than populated with plausible-looking sample rows.
 */
export async function GET() {
  const path = join(process.cwd(), '..', 'loop', 'memory', 'audit.jsonl');

  if (!existsSync(path)) {
    return NextResponse.json({ entries: [], source: path, present: false });
  }

  try {
    const entries = readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line))
      .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));

    return NextResponse.json({ entries, source: path, present: true });
  } catch (error) {
    return NextResponse.json(
      { entries: [], present: false, error: String(error) },
      { status: 500 }
    );
  }
}
