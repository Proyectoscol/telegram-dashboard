'use client';

import { useState, useRef } from 'react';

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    chatId?: number;
    chatName?: string;
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

  const [userFile, setUserFile] = useState<File | null>(null);
  const [userLoading, setUserLoading] = useState(false);
  const [userResult, setUserResult] = useState<{
    created: number;
    updated: number;
    total: number;
    errors?: string[];
    errorCount?: number;
  } | null>(null);
  const [userError, setUserError] = useState<string | null>(null);
  const userInputRef = useRef<HTMLInputElement>(null);

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

  const handleUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userFile) {
      setUserError('Please select a file.');
      return;
    }
    setUserError(null);
    setUserResult(null);
    setUserLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', userFile);
      const res = await fetch('/api/import/users-update', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setUserResult(data);
      setUserFile(null);
      if (userInputRef.current) userInputRef.current.value = '';
    } catch (err) {
      setUserError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUserLoading(false);
    }
  };

  return (
    <div>
      <h1>Import data</h1>
      <p style={{ color: '#8b98a5', marginBottom: '1.5rem', fontSize: '0.9375rem' }}>
        Two import types: <strong>Chat export</strong> (messages and reactions) and <strong>User info</strong> (profile data to update contacts).
      </p>

      <section className="card" style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ marginTop: 0, marginBottom: '0.5rem', fontSize: '1.1rem' }}>Chat export (messages &amp; reactions)</h2>
        <p style={{ color: '#8b98a5', marginBottom: '1rem', fontSize: '0.875rem' }}>
          Upload <code style={{ background: '#2f3336', padding: '0.2rem 0.4rem', borderRadius: 4 }}>result.json</code> from Telegram. New messages and reactions are stored; existing ones are skipped. Feed the system daily or weekly.
        </p>
        <form onSubmit={handleSubmit}>
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
                Import complete.
                {(result.chatName != null || result.chatId != null) && (
                  <span> Imported into: <strong>{result.chatName ?? 'Chat'} (id: {result.chatId})</strong>. </span>
                )}
                Messages inserted: {result.messagesInserted}, skipped: {result.messagesSkipped}.
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
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0, marginBottom: '0.5rem', fontSize: '1.1rem' }}>User info (update contacts)</h2>
        <p style={{ color: '#8b98a5', marginBottom: '1rem', fontSize: '0.875rem' }}>
          Upload a JSON file with user profile data (e.g. from a user-list export). Each entry&apos;s <code style={{ background: '#2f3336', padding: '0.2rem 0.4rem', borderRadius: 4 }}>id</code> is matched to <code>from_id</code> as <code>user</code> + id (e.g. <code>5164610325</code> → <code>user5164610325</code>). Existing users are updated; new IDs create new contact rows.
        </p>
        <form onSubmit={handleUserSubmit}>
          <div className="upload-zone">
            <label className="form-group">
              <span style={{ display: 'block', marginBottom: '0.5rem' }}>Select user info JSON</span>
              <input
                ref={userInputRef}
                type="file"
                accept=".json,application/json"
                onChange={(e) => setUserFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <p>{userFile ? userFile.name : 'No file selected'}</p>
          </div>
          {userError && <div className="alert alert-error">{userError}</div>}
          {userResult && (
            <>
              <div className="alert alert-success">
                User info import complete. Created: {userResult.created}, updated: {userResult.updated}, total processed: {userResult.total}.
              </div>
              {userResult.errorCount != null && userResult.errorCount > 0 && (
                <div className="alert" style={{ background: 'rgba(255, 165, 0, 0.15)', border: '1px solid #f90', color: '#f90' }}>
                  {userResult.errorCount} row(s) had errors.
                  {userResult.errors && userResult.errors.length > 0 && (
                    <details style={{ marginTop: '0.5rem', fontSize: '0.8125rem' }}>
                      <summary>First errors</summary>
                      <ul style={{ margin: '0.35rem 0 0 1rem', padding: 0 }}>
                        {userResult.errors.slice(0, 10).map((e, i) => (
                          <li key={i} style={{ marginBottom: '0.25rem' }}>{e}</li>
                        ))}
                        {userResult.errors.length > 10 && <li>… and {userResult.errors.length - 10} more</li>}
                      </ul>
                    </details>
                  )}
                </div>
              )}
            </>
          )}
          <button type="submit" className="btn" disabled={!userFile || userLoading}>
            {userLoading ? 'Uploading…' : 'Upload and update users'}
          </button>
        </form>
      </section>
    </div>
  );
}
