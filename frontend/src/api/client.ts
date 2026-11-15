import { appConfig } from '../config/app';
import type { AnalysisRequest, ChatRequest, ChatResponse, Dataset, ExampleCase, Health, Job, Place, RegionShape, TrendApi, Variable } from './types';

/** Error carrying the HTTP status and the FastAPI `detail` message. */
export class ApiRequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

function detailToText(detail: unknown): string {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    // FastAPI validation errors: [{ loc, msg, ... }]
    return detail
      .map((d) => (d && typeof d === 'object' && 'msg' in d ? String((d as { msg: unknown }).msg) : String(d)))
      .join('; ');
  }
  return 'Something went wrong talking to the server.';
}

async function request<T>(path: string, init?: RequestInit, as: 'json' | 'text' = 'json'): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${appConfig.apiBase}${path}`, init);
  } catch (e) {
    if (init?.signal?.aborted) throw e;
    throw new ApiRequestError('Could not reach the server. Check that the backend is running.', 0);
  }
  if (!res.ok) {
    let message = `Request failed (${res.status}).`;
    try {
      const body = await res.json();
      message = detailToText(body?.detail);
    } catch {
      /* non-JSON error body */
    }
    throw new ApiRequestError(message, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (as === 'text' ? res.text() : res.json()) as Promise<T>;
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/** Real HTTP implementation of the contract in docs/API.md. */
export const httpApi: TrendApi = {
  health: () => request<Health>('/health'),
  listVariables: () => request<Variable[]>('/variables'),
  getVariable: (id) => request<Variable>(`/variables/${encodeURIComponent(id)}`),
  listExamples: () => request<ExampleCase[]>('/examples'),
  createAnalysis: (req: AnalysisRequest) => request<Job>('/analyses', json(req)),
  getAnalysis: (id) => request<Job>(`/analyses/${encodeURIComponent(id)}`),
  getAnalysisCsv: (id) => request<string>(`/analyses/${encodeURIComponent(id)}/csv`, undefined, 'text'),
  uploadDataset: (file, name, units) => {
    const form = new FormData();
    form.append('file', file);
    if (name) form.append('name', name);
    if (units) form.append('units', units);
    return request<Dataset>('/datasets', { method: 'POST', body: form });
  },
  listDatasets: () => request<Dataset[]>('/datasets'),
  deleteDataset: (id) => request<void>(`/datasets/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  chat: (req: ChatRequest) => request<ChatResponse>('/chat', json(req)),
  geocode: (q, limit = 6, signal) => request<Place[]>(`/geocode?${new URLSearchParams({ q, limit: String(limit) })}`, { signal }),
  getRegionShape: (osm) => request<RegionShape>(`/regions/shape?${new URLSearchParams({ osm })}`),
};

/** The API everyone should call. There is no offline fallback: if the backend is down, calls fail. */
export const api: TrendApi = httpApi;

/** Is the backend answering? Used once at startup to show a clear "can't reach the server" state. */
export async function checkHealth(): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), appConfig.healthTimeoutMs);
  try {
    const res = await fetch(`${appConfig.apiBase}/health`, { signal: ctrl.signal });
    if (!res.ok) return false;
    const body = await res.json();
    return body?.status === 'ok';
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
