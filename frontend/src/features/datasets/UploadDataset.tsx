import { useRef, useState } from 'react';
import { api } from '../../api/client';
import { Button } from '../../components/Button';
import { IconUpload } from '../../components/icons';
import { useStore } from '../../state/store';
import './datasets.css';

/** Upload a CSV with header "date,value". It becomes selectable under "Your data". */
export function UploadDataset({ onUploaded }: { onUploaded: (id: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [units, setUnits] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setFile(null);
    setName('');
    setUnits('');
    if (input.current) input.current.value = '';
  };

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const ds = await api.uploadDataset(file, name || undefined, units || undefined);
      useStore.getState().set({ datasets: [...useStore.getState().datasets.filter((d) => d.id !== ds.id), ds] });
      reset();
      onUploaded(ds.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="upload">
      <input
        ref={input}
        type="file"
        accept=".csv,text/csv"
        className="upload__file"
        id="upload-file"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          setFile(f);
          setError(null);
          if (f && !name) setName(f.name.replace(/\.csv$/i, ''));
        }}
      />
      {!file ? (
        <label htmlFor="upload-file" className="upload__drop" tabIndex={0} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}>
          <IconUpload />
          <span>
            Upload a CSV
            <span className="hint"> with two columns, <code>date,value</code> (dates as YYYY-MM-DD)</span>
          </span>
        </label>
      ) : (
        <div className="upload__form">
          <p className="hint">{file.name}</p>
          <div className="upload__fields">
            <label>
              <span>Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My weather station" />
            </label>
            <label>
              <span>Units</span>
              <input value={units} onChange={(e) => setUnits(e.target.value)} placeholder="°C" />
            </label>
          </div>
          <div className="upload__actions">
            <Button size="s" variant="primary" onClick={upload} disabled={busy}>
              {busy ? 'Uploading…' : 'Add dataset'}
            </Button>
            <Button size="s" variant="ghost" onClick={reset} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
