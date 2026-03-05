/**
 * Runs once per Node.js server start (not in Edge runtime).
 * Logs startup milestones for Easy Panel / deployment verification.
 * No deploy trigger — avoids restart loops on transient errors.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { log } = await import('./lib/logger');

  log.star('⭐️ Telegram Dashboard starting');
  log.star(`⭐️ Node ${process.version} | env: ${process.env.NODE_ENV ?? 'unknown'} | port: ${process.env.PORT ?? '3000'}`);

  const hasDb =
    !!process.env.DATABASE_URL ||
    !!(process.env.POSTGRES_HOST && process.env.POSTGRES_USER && process.env.POSTGRES_PASSWORD);
  const hasSupabaseAuth = !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
  const hasSupabaseServiceRole = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasRedis = !!process.env.REDIS_URL;

  const dbSource = process.env.DATABASE_URL
    ? 'DATABASE_URL'
    : process.env.POSTGRES_HOST
      ? `POSTGRES_HOST=${process.env.POSTGRES_HOST}`
      : '❌ NOT SET';

  log.star(
    `⭐️ Config — DB: ${hasDb ? `✅ (${dbSource})` : '❌ MISSING'} | Supabase Auth: ${
      hasSupabaseAuth ? '✅' : '⚠️  disabled'
    } | Service Role: ${hasSupabaseServiceRole ? '✅' : '⚠️  not set'} | OpenAI: ${
      hasOpenAI ? '✅' : '⚠️  not set (AI disabled)'
    } | Redis: ${hasRedis ? '✅' : '⚠️  in-memory cache'}`
  );

  if (!hasDb) {
    log.fatal('No database configured. Set DATABASE_URL or POSTGRES_* and redeploy.');
    throw new Error('Database environment variables are missing — cannot start.');
  }

  process.on('uncaughtException', (err) => {
    log.fatal('uncaughtException — process may exit', err);
  });
  process.on('unhandledRejection', (reason) => {
    log.fatal(
      'unhandledRejection — possible crash cause',
      reason instanceof Error ? reason : new Error(String(reason))
    );
  });

  try {
    const { pool, ensureSchema, validateSchema } = await import('./lib/db/client');

    log.star('⭐️ Testing database connection (SELECT 1)…');
    await pool.query('SELECT 1');
    log.star('⭐️ ✅ Database connection OK');

    log.star('⭐️ Running schema migrations…');
    await ensureSchema();
    log.star('⭐️ ✅ Schema migrations complete');

    log.star('⭐️ Validating all required tables…');
    const missingTables = await validateSchema();
    if (missingTables.length === 0) {
      log.star('⭐️ ✅ All tables present (chats, users, messages, reactions, settings, day_insights, …)');
    } else {
      log.star(`⭐️ ⚠️  Missing tables: [${missingTables.join(', ')}]`);
    }

    if (hasRedis) {
      try {
        const { pingRedis } = await import('./lib/redis');
        const ok = await pingRedis();
        if (ok) {
          log.star('⭐️ ✅ Redis connection OK — cache will use Redis');
        } else {
          log.star('⭐️ ⚠️  Redis ping failed — cache will fall back to in-memory');
        }
      } catch (err) {
        log.star('⭐️ ⚠️  Redis connection failed — cache will use in-memory', err);
      }
    }

    log.star('⭐️ 🚀 Application ready — server is accepting requests');
  } catch (err) {
    log.fatal('⭐️ ❌ Startup failed', err);
    throw err;
  }
}
