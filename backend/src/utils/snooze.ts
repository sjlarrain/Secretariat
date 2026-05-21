export type SnoozeOption = '1d' | '3d' | 'monday';

// Returns the next Monday after `from` (never `from` itself if it is already Monday)
function nextMonday(from: Date): Date {
  const d = new Date(from);
  const day = d.getDay(); // 0=Sun, 1=Mon ... 6=Sat
  const daysUntilMonday = day === 1 ? 7 : (8 - day) % 7;
  d.setDate(d.getDate() + daysUntilMonday);
  d.setHours(9, 0, 0, 0);
  return d;
}

export function getSnoozeDate(option: SnoozeOption, defaultTime = '09:00'): Date {
  const now = new Date();
  const [hh, mm] = defaultTime.split(':').map(Number);

  if (option === '1d') {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(hh, mm, 0, 0);
    return d;
  }

  if (option === '3d') {
    const d = new Date(now);
    d.setDate(d.getDate() + 3);
    d.setHours(hh, mm, 0, 0);
    return d;
  }

  // monday
  return nextMonday(now);
}
