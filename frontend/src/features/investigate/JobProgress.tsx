import type { Job } from '../../api/types';

const LABEL: Record<Job['status'], string> = {
  queued: 'Waiting in line',
  fetching: 'Fetching data',
  processing: 'Preparing the series',
  analyzing: 'Testing the trend',
  done: 'Done',
  error: 'Something went wrong',
};

export function JobProgress({ job }: { job: Job }) {
  const pct = Math.round(job.progress * 100);
  return (
    <div className="progress" role="status" aria-live="polite">
      <div className="progress__head">
        <span>{LABEL[job.status]}</span>
        <span className="progress__pct">{pct}%</span>
      </div>
      <div className="progress__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <span style={{ transform: `scaleX(${job.progress})` }} />
      </div>
      {job.message && <p className="hint">{job.message}</p>}
    </div>
  );
}
