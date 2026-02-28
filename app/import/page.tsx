'use client';

import { useState, useRef } from 'react';

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    messagesInserted: number;
    messagesSkipped: number;
    reactionsInserted: number;
    reactionsSkipped: number;
    usersUpserted: number;
    errors?: string[];
    messageErrors?: number;
    reactionErrors?: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError('Please select a file.');
      return;
    }
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/ingest', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setResult(data);
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h1>Import data</h1>
      <p style={{ color: '#8b98a5', marginBottom: '1.5rem', fontSize: '0.9375rem' }}>
        Upload a <code style={{ background: '#2f3336', padding: '0.2rem 0.4rem', borderRadius: 4 }}>result.json</code> from Telegram. You can upload the same file or a new export (e.g. next day) anytime—only new messages and reactions are stored; existing ones are skipped by ID. Feed the system daily or weekly.
      </p>

      <form onSubmit={handleSubmit} className="card">
        <div className="upload-zone">
          <label className="form-group">
            <span style={{ display: 'block', marginBottom: '0.5rem' }}>Select file</span>
            <input
              ref={inputRef}
              type="file"
              accept=".json,application/json"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <p>{file ? file.name : 'No file selected'}</p>
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        {result && (
          <>
            <div className="alert alert-success">
              Import complete. Messages inserted: {result.messagesInserted}, skipped: {result.messagesSkipped}.
              Reactions inserted: {result.reactionsInserted}, skipped: {result.reactionsSkipped}.
              Users upserted: {result.usersUpserted}.
            </div>
            {(result.messageErrors !== undefined && result.messageErrors > 0) || (result.reactionErrors !== undefined && result.reactionErrors > 0) ? (
              <div className="alert" style={{ background: 'rgba(255, 165, 0, 0.15)', border: '1px solid #f90', color: '#f90' }}>
                Some items were skipped due to errors: {result.messageErrors ?? 0} message(s), {result.reactionErrors ?? 0} reaction(s).
                {result.errors && result.errors.length > 0 && (
                  <details style={{ marginTop: '0.5rem', fontSize: '0.8125rem' }}>
                    <summary>First errors</summary>
                    <ul style={{ margin: '0.35rem 0 0 1rem', padding: 0 }}>
                      {result.errors.slice(0, 10).map((e, i) => (
                        <li key={i} style={{ marginBottom: '0.25rem' }}>{e}</li>
                      ))}
                      {result.errors.length > 10 && <li>… and {result.errors.length - 10} more</li>}
                    </ul>
                  </details>
                )}
              </div>
            ) : null}
          </>
        )}

        <button type="submit" className="btn" disabled={!file || loading}>
          {loading ? 'Uploading…' : 'Upload and import'}
        </button>
      </form>
    </div>
  );
}
