export function shortAddress(address?: string, lead = 6, tail = 4): string {
  if (!address || address.length < lead + tail) return address ?? '—';
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}

/** days·hours·minutes, matching the selected direction's readout. */
export function splitDuration(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  return {
    days: Math.floor(s / 86400),
    hours: Math.floor((s % 86400) / 3600),
    minutes: Math.floor((s % 3600) / 60),
    seconds: s % 60,
  };
}

export function formatCountdown(totalSeconds: number): string {
  const { days, hours, minutes } = splitDuration(totalSeconds);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(days)}·${pad(hours)}·${pad(minutes)}`;
}

export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC',
  });
}

export function formatGas(gas?: string): string {
  if (!gas) return '—';
  return `${Number(gas).toLocaleString('en-US')} gas`;
}
