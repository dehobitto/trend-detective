import { api } from '../../api/client';

/** Fetch the job's CSV from the API and save it via a temporary object URL. */
export async function downloadCsv(jobId: string, filename: string) {
  const text = await api.getAnalysisCsv(jobId);
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
