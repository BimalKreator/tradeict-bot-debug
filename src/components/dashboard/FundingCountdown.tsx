'use client';

import { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';

/**
 * Time remaining until the next hour boundary (HH:00:00 UTC).
 * All funding intervals (1h, 2h, 4h, 8h) align with the start of an hour.
 */
function getNextFundingMs(): number {
  const now = new Date();
  const hours = now.getUTCHours();
  const utcMs =
    hours * 3600000 +
    now.getUTCMinutes() * 60000 +
    now.getUTCSeconds() * 1000 +
    now.getUTCMilliseconds();
  const nextHourMs = (hours + 1) * 3600000;
  let diff = nextHourMs - utcMs;
  if (diff <= 0) diff += 24 * 3600000;
  return diff;
}

function msToHMS(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function FundingCountdown() {
  const [remaining, setRemaining] = useState<number>(getNextFundingMs());

  useEffect(() => {
    const tick = () => {
      setRemaining((prev) => {
        const next = prev - 1000;
        return next <= 0 ? getNextFundingMs() : next;
      });
    };
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/5 px-3 py-2 text-sm">
      <Clock className="h-4 w-4 text-cyan-400" />
      <span className="text-white/70">Next Hourly Funding:</span>
      <span className="font-mono font-semibold tabular-nums text-cyan-400">
        {msToHMS(remaining)}
      </span>
    </div>
  );
}
