import { DateTime } from "luxon";

export function toMinutes(hhmm: number): number {
  return Math.floor(hhmm / 100) * 60 + (hhmm % 100);
}

export function pickNextRun(
  windowStart: number,
  windowEnd: number,
  tz: string,
  forceTomorrow = false,
): DateTime {
  const startMin = toMinutes(windowStart);
  const endMin = toMinutes(windowEnd);
  const now = DateTime.now().setZone(tz);
  const nowMin = now.hour * 60 + now.minute;

  if (!forceTomorrow) {
    if (nowMin < startMin) {
      const randomMin =
        startMin + Math.floor(Math.random() * Math.max(1, endMin - startMin));
      return now.set({
        hour: Math.floor(randomMin / 60),
        minute: randomMin % 60,
        second: 0,
        millisecond: 0,
      });
    }
    if (nowMin < endMin) {
      const remaining = endMin - (nowMin + 1);
      if (remaining > 0) {
        const randomMin = nowMin + 1 + Math.floor(Math.random() * remaining);
        return now.set({
          hour: Math.floor(randomMin / 60),
          minute: randomMin % 60,
          second: 0,
          millisecond: 0,
        });
      }
      // Under a minute left in today's window — fall through to tomorrow
    }
  }

  const randomMin =
    startMin + Math.floor(Math.random() * Math.max(1, endMin - startMin));
  return now
    .plus({ days: 1 })
    .set({
      hour: Math.floor(randomMin / 60),
      minute: randomMin % 60,
      second: 0,
      millisecond: 0,
    });
}
