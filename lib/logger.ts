/**
 * Simple structured logger for Easy Panel / stdout.
 * All output goes to console so it appears in deployment logs.
 */

const ts = () => new Date().toISOString();

function write(level: string, tag: string, message: string, err?: unknown) {
  const payload: Record<string, unknown> = { time: ts(), level, tag, message };
  if (err !== undefined) {
    payload.error = err instanceof Error ? err.message : String(err);
    if (err instanceof Error && err.stack) payload.stack = err.stack;
  }
  const line = JSON.stringify(payload);
  if (level === 'ERROR' || level === 'FATAL') {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const log = {
  /** ⭐️ Startup milestone — always visible in deployment logs. */
  star(message: string, err?: unknown) {
    write('INFO', 'STARTUP', message, err);
  },
  startup(message: string, err?: unknown) {
    write('INFO', 'STARTUP', message, err);
  },
  api(message: string, meta?: Record<string, unknown>) {
    const msg = meta ? `${message} ${JSON.stringify(meta)}` : message;
    write('INFO', 'API', msg);
  },
  db(message: string, err?: unknown) {
    if (err !== undefined) write('ERROR', 'DB', message, err);
    else write('INFO', 'DB', message);
  },
  error(tag: string, message: string, err?: unknown) {
    write('ERROR', tag, message, err);
  },
  fatal(message: string, err?: unknown) {
    write('FATAL', 'FATAL', message, err);
  },
  /** Log AI token usage (in/out) for auditing in deployment logs. */
  aiUsage(tag: string, meta: { prompt_tokens: number; completion_tokens: number; model?: string; entity_type?: string; entity_id?: unknown }) {
    const payload = { time: ts(), level: 'INFO', tag, message: 'AI usage', ...meta };
    console.log(JSON.stringify(payload));
  },
};
