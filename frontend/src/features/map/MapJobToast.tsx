import { useEffect, useState } from 'react';
import { useSelectedVariable, useStore } from '../../state/store';

const STAGE = {
  queued: { scientist: 'Queued', kid: 'Getting ready' },
  fetching: { scientist: 'Downloading from NASA', kid: 'Searching NASA’s archives' },
  processing: { scientist: 'Preparing the series', kid: 'Sorting the clues' },
  analyzing: { scientist: 'Testing the trend', kid: 'Checking if it’s a fluke' },
  done: { scientist: 'Done', kid: 'Case cracked!' },
  error: { scientist: 'Could not finish', kid: 'The trail went cold' },
} as const;

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * Live status of the running analysis, floating over the bottom of the map where it can't be missed:
 * stage, the backend's own message ("Downloading from NASA: 12 of 275 files…"), a progress bar and a clock.
 * It stays below the map notice (top) and above the timeline dock. Briefly confirms "Done", then goes away.
 */
export function MapJobToast({ besidePanel }: { besidePanel: boolean }) {
  const job = useStore((s) => s.job);
  const kid = useStore((s) => s.audience === 'kid');
  const variable = useSelectedVariable();
  const hasDock = !!variable && variable.coverage !== 'series'; // the timeline dock (or its 'no imagery' note) sits below
  const [now, setNow] = useState(() => Date.now());
  const [startedAt, setStartedAt] = useState<{ id: string; t: number } | null>(null);
  const [lingering, setLingering] = useState<string | null>(null);

  const running = !!job && job.status !== 'done' && job.status !== 'error';
  useEffect(() => {
    if (!job) return;
    if (running && startedAt?.id !== job.id) setStartedAt({ id: job.id, t: Date.now() });
  }, [job, running, startedAt]);
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [running]);
  // Show "Done" for a moment after a run we watched.
  useEffect(() => {
    if (job?.status !== 'done' || startedAt?.id !== job.id) return;
    setLingering(job.id);
    const t = window.setTimeout(() => setLingering(null), 1600);
    return () => window.clearTimeout(t);
  }, [job?.status, job?.id, startedAt?.id]);

  if (!job || (!running && lingering !== job.id)) return null;
  const pct = Math.round(job.progress * 100);
  const elapsed = startedAt?.id === job.id ? (now - startedAt.t) / 1000 : 0;
  const label = STAGE[job.status][kid ? 'kid' : 'scientist'];
  // The backend's download message already explains the first-time wait; only add it when it doesn't.
  const slow = running && elapsed > 20 && !/first time/i.test(job.message ?? '');

  return (
    <div className="job-toast" data-beside-panel={besidePanel} data-dock={hasDock} data-status={job.status} role="status" aria-live="polite">
      <div className="job-toast__row">
        <span className="job-toast__spin" aria-hidden data-done={job.status === 'done'} />
        <span className="job-toast__stage">{label}</span>
        {variable && <span className="job-toast__var">{variable.name}</span>}
        <span className="job-toast__time" aria-label="Elapsed">
          {running ? mmss(elapsed) : '✓'}
        </span>
      </div>
      <div className="job-toast__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <span style={{ transform: `scaleX(${job.status === 'done' ? 1 : job.progress})` }} />
      </div>
      {running && job.message && <p className="job-toast__msg">{job.message}</p>}
      {slow && (
        <p className="job-toast__hint">
          {kid ? 'Big archives take a while the first time. After that this place is instant.' : 'A new area is fetched from NASA once; afterwards it is cached and instant.'}
        </p>
      )}
    </div>
  );
}
