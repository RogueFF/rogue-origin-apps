import { useEffect, useState } from 'react';

interface ClockZone {
  label: string;
  tz: string;
}

const ZONES: ClockZone[] = [
  { label: 'PST', tz: 'America/Los_Angeles' },
  { label: 'CET', tz: 'Europe/Zurich' },       // Switzerland
  { label: 'CET', tz: 'Europe/Prague' },        // Czech Republic
];

function formatTime(tz: string): string {
  return new Date().toLocaleTimeString('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function formatDate(tz: string): string {
  const d = new Date();
  const day = d.toLocaleDateString('en-US', { timeZone: tz, weekday: 'short' });
  return day.toUpperCase();
}

/**
 * War room clock strip — PST, Zurich, Prague.
 * Updates every second. Tabular nums for no layout jitter.
 */
export function WarClock() {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Dedupe CET display — if same time, show once with combined label
  const times = ZONES.map(z => ({ ...z, time: formatTime(z.tz), day: formatDate(z.tz) }));
  const zurich = times[1];
  const prague = times[2];
  const cetSame = zurich.time === prague.time;

  void tick; // force re-render

  return (
    <div className="clock-strip">
      {/* Local — Oregon */}
      <div className="clock-zone">
        <span className="clock-time">{times[0].time}</span>
        <span className="clock-label">{times[0].day} {times[0].label}</span>
      </div>

      <span style={{ color: 'var(--border-card)', fontSize: 10 }}>│</span>

      {cetSame ? (
        <div className="clock-zone">
          <span className="clock-time">{zurich.time}</span>
          <span className="clock-label">{zurich.day} CH/CZ</span>
        </div>
      ) : (
        <>
          <div className="clock-zone">
            <span className="clock-time">{zurich.time}</span>
            <span className="clock-label">{zurich.day} CH</span>
          </div>
          <div className="clock-zone">
            <span className="clock-time">{prague.time}</span>
            <span className="clock-label">{prague.day} CZ</span>
          </div>
        </>
      )}
    </div>
  );
}
