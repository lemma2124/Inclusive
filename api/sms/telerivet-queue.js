import { createHash, randomUUID } from 'node:crypto';

const STREAM = 'inclusive:sms:telerivet:inbound';
const GROUP = 'inclusive-sms-workers';
const DEAD_STREAM = 'inclusive:sms:telerivet:dead';
const RETRY_SET = 'inclusive:sms:telerivet:retries';
const DEDUPE_TTL_SECONDS = 48 * 60 * 60;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_RETRY_BASE_MS = 1000;
const DEFAULT_RETRY_MAX_MS = 30000;
const DEFAULT_LEASE_MS = 30000;
const DEFAULT_CLAIM_IDLE_MS = 5000;

const ENQUEUE_SCRIPT = `
-- operation:enqueue
local existing = redis.call('GET', KEYS[1])
if existing then return {0, existing} end
local stream_id = redis.call(
  'XADD', KEYS[2], '*',
  'job_key', KEYS[3],
  'message_id', ARGV[1],
  'from', ARGV[2],
  'text', ARGV[3]
)
redis.call('HSET', KEYS[3],
  'status', 'queued',
  'attempts', '0',
  'message_id', ARGV[1],
  'from', ARGV[2],
  'text', ARGV[3],
  'created_at', ARGV[4],
  'updated_at', ARGV[4],
  'stream_id', stream_id
)
redis.call('SET', KEYS[1], 'queued')
return {1, stream_id}
`;

const START_PROCESSING_SCRIPT = `
-- operation:start_processing
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return {0, 'lock_lost'} end
local status = redis.call('HGET', KEYS[2], 'status')
if status == 'done' or status == 'dead' then return {0, status} end
if status == 'retry' then return {0, status} end
if not status then
  redis.call('HSET', KEYS[2],
    'status', 'queued',
    'attempts', '0',
    'message_id', ARGV[4],
    'from', ARGV[5],
    'text', ARGV[6],
    'created_at', ARGV[2],
    'updated_at', ARGV[2]
  )
end
local attempt = redis.call('HINCRBY', KEYS[2], 'attempts', 1)
redis.call('HSET', KEYS[2],
  'status', 'processing',
  'updated_at', ARGV[2],
  'stream_id', ARGV[3],
  'worker', ARGV[1]
)
return {1, attempt}
`;

const RENEW_LEASE_SCRIPT = `
-- operation:renew_lease
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
`;

const RELEASE_LEASE_SCRIPT = `
-- operation:release_lease
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

const COMPLETE_SCRIPT = `
-- operation:complete
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('HSET', KEYS[2],
  'status', 'done',
  'completed_at', ARGV[4],
  'updated_at', ARGV[4],
  'last_error', '',
  'error_code', '',
  'next_attempt_at', ''
)
redis.call('EXPIRE', KEYS[2], ARGV[3])
redis.call('SET', KEYS[3], 'done', 'EX', ARGV[3])
redis.call('XACK', KEYS[4], ARGV[5], ARGV[2])
redis.call('XDEL', KEYS[4], ARGV[2])
redis.call('DEL', KEYS[1])
return 1
`;

const FAIL_OR_RETRY_SCRIPT = `
-- operation:fail_or_retry
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return {0, 'lock_lost'} end
if ARGV[8] == '1' or tonumber(ARGV[3]) >= tonumber(ARGV[4]) then
  local dead_id = redis.call('XADD', KEYS[6], '*',
    'job_key', KEYS[2],
    'message_id', redis.call('HGET', KEYS[2], 'message_id') or '',
    'from', redis.call('HGET', KEYS[2], 'from') or '',
    'text', redis.call('HGET', KEYS[2], 'text') or '',
    'attempts', ARGV[3],
    'error_code', ARGV[5],
    'error', ARGV[6],
    'failed_at', ARGV[10]
  )
  redis.call('HSET', KEYS[2],
    'status', 'dead',
    'last_error', ARGV[6],
    'error_code', ARGV[5],
    'failed_at', ARGV[10],
    'dead_stream_id', dead_id,
    'next_attempt_at', ''
  )
  redis.call('HSET', KEYS[2], 'updated_at', ARGV[10])
  redis.call('SET', KEYS[3], 'dead')
  redis.call('XACK', KEYS[4], ARGV[9], ARGV[2])
  redis.call('XDEL', KEYS[4], ARGV[2])
  redis.call('DEL', KEYS[1])
  return {2, dead_id}
end
redis.call('ZADD', KEYS[5], ARGV[7], KEYS[2])
redis.call('HSET', KEYS[2],
  'status', 'retry',
  'last_error', ARGV[6],
  'error_code', ARGV[5],
  'next_attempt_at', ARGV[7],
  'updated_at', ARGV[10]
)
redis.call('SET', KEYS[3], 'retry')
redis.call('XACK', KEYS[4], ARGV[9], ARGV[2])
redis.call('XDEL', KEYS[4], ARGV[2])
redis.call('DEL', KEYS[1])
return {1, ARGV[7]}
`;

const DISPATCH_RETRIES_SCRIPT = `
-- operation:dispatch_retries
local due = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, ARGV[2])
local dispatched = 0
for _, job_key in ipairs(due) do
  if redis.call('HGET', job_key, 'status') == 'retry' then
    local stream_id = redis.call('XADD', KEYS[2], '*',
      'job_key', job_key,
      'message_id', redis.call('HGET', job_key, 'message_id') or '',
      'from', redis.call('HGET', job_key, 'from') or '',
      'text', redis.call('HGET', job_key, 'text') or ''
    )
    redis.call('HSET', job_key,
      'status', 'queued',
      'stream_id', stream_id,
      'next_attempt_at', '',
      'updated_at', ARGV[1]
    )
    local suffix = string.match(job_key, 'state:(.+)$')
    if suffix then redis.call('SET', 'inclusive:sms:telerivet:message:' .. suffix, 'queued') end
    dispatched = dispatched + 1
  end
  redis.call('ZREM', KEYS[1], job_key)
end
return dispatched
`;

const RETRY_FAILED_SCRIPT = `
-- operation:retry_failed
if redis.call('HGET', KEYS[1], 'status') ~= 'dead' then
  return {0, redis.call('HGET', KEYS[1], 'status') or 'missing'}
end
local dead_id = redis.call('HGET', KEYS[1], 'dead_stream_id')
local stream_id = redis.call('XADD', KEYS[3], '*',
  'job_key', KEYS[1],
  'message_id', redis.call('HGET', KEYS[1], 'message_id') or '',
  'from', redis.call('HGET', KEYS[1], 'from') or '',
  'text', redis.call('HGET', KEYS[1], 'text') or ''
)
redis.call('HSET', KEYS[1],
  'status', 'queued',
  'attempts', '0',
  'updated_at', ARGV[2],
  'stream_id', stream_id,
  'last_error', '',
  'error_code', '',
  'failed_at', '',
  'dead_stream_id', '',
  'next_attempt_at', ''
)
redis.call('ZREM', KEYS[5], KEYS[1])
redis.call('SET', KEYS[2], 'queued')
if dead_id then redis.call('XDEL', KEYS[4], dead_id) end
return {1, stream_id}
`;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function messageHash(messageId) {
  return createHash('sha256').update(messageId).digest('hex');
}

function dedupeKey(messageId) {
  return `inclusive:sms:telerivet:message:${messageHash(messageId)}`;
}

function stateKey(messageId) {
  return `inclusive:sms:telerivet:state:${messageHash(messageId)}`;
}

function errorInfo(error) {
  return {
    code: typeof error?.code === 'string' ? error.code : 'sms_processing_error',
    message: String(error?.message || 'SMS processing failed.').slice(0, 500),
    retryable: error?.retryable !== false
  };
}

function numberOption(value, fallback, min = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.floor(parsed)) : fallback;
}

export function createTelerivetSmsQueue({
  client,
  runtime,
  logError = console.error,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  retryBaseMs = DEFAULT_RETRY_BASE_MS,
  retryMaxMs = DEFAULT_RETRY_MAX_MS,
  leaseMs = DEFAULT_LEASE_MS,
  claimIdleMs = DEFAULT_CLAIM_IDLE_MS,
  now = Date.now
}) {
  if (!client) throw new Error('A Redis client is required for the Telerivet SMS queue.');
  if (!runtime || typeof runtime.handleInbound !== 'function') {
    throw new Error('An SMS runtime is required for the Telerivet SMS queue.');
  }

  const attemptsLimit = numberOption(maxAttempts, DEFAULT_MAX_ATTEMPTS);
  const retryBase = numberOption(retryBaseMs, DEFAULT_RETRY_BASE_MS);
  const retryMax = numberOption(retryMaxMs, DEFAULT_RETRY_MAX_MS);
  const leaseDuration = numberOption(leaseMs, DEFAULT_LEASE_MS, 1000);
  const claimIdle = numberOption(claimIdleMs, DEFAULT_CLAIM_IDLE_MS, 1000);
  const consumer = `sms-${process.pid}-${randomUUID()}`;
  let stopping = false;
  let workerPromise = null;

  async function acknowledge(entryId) {
    await client.xAck(STREAM, GROUP, entryId);
    await client.xDel(STREAM, entryId);
  }

  async function completeJob(entry, jobKey, leaseKey, token) {
    const message = entry.message || {};
    const result = await client.eval(COMPLETE_SCRIPT, {
      keys: [leaseKey, jobKey, dedupeKey(message.message_id), STREAM],
      arguments: [token, entry.id, String(DEDUPE_TTL_SECONDS), String(now()), GROUP]
    });
    return Number(result) === 1;
  }

  async function failOrRetry(entry, jobKey, leaseKey, token, attempt, error, forceDead = false) {
    const message = entry.message || {};
    const info = errorInfo(error);
    const retryAt = now() + Math.min(retryBase * (2 ** Math.max(0, attempt - 1)), retryMax);
    const result = await client.eval(FAIL_OR_RETRY_SCRIPT, {
      keys: [leaseKey, jobKey, dedupeKey(message.message_id), STREAM, RETRY_SET, DEAD_STREAM],
      arguments: [
        token,
        entry.id,
        String(attempt),
        String(attemptsLimit),
        info.code,
        info.message,
        String(retryAt),
        forceDead || !info.retryable ? '1' : '0',
        GROUP,
        String(now())
      ]
    });
    if (Number(result?.[0]) === 0) return false;
    return Number(result[0]) === 1 ? 'retry' : 'dead';
  }

  async function dispatchRetries() {
    await client.eval(DISPATCH_RETRIES_SCRIPT, {
      keys: [RETRY_SET, STREAM],
      arguments: [String(now()), '20']
    });
  }

  async function processMessage(entry) {
    const message = entry.message || {};
    const messageId = message.message_id || '';
    if (!messageId) {
      await acknowledge(entry.id);
      return;
    }

    const jobKey = message.job_key || stateKey(messageId);
    const lockKey = `${jobKey}:lease`;
    const currentState = await client.hGetAll(jobKey);
    const dedupeStatus = await client.get(dedupeKey(messageId));
    if (currentState.status === 'done' || currentState.status === 'dead' || dedupeStatus === 'done') {
      await acknowledge(entry.id);
      return;
    }
    if (currentState.status === 'retry') {
      await acknowledge(entry.id);
      return;
    }

    const token = randomUUID();
    const locked = await client.set(lockKey, token, { NX: true, PX: leaseDuration });
    if (locked !== 'OK') return;

    const started = await client.eval(START_PROCESSING_SCRIPT, {
      keys: [lockKey, jobKey],
      arguments: [token, String(now()), entry.id, messageId, message.from || '', message.text || '']
    });
    if (Number(started?.[0]) !== 1) {
      await client.eval(RELEASE_LEASE_SCRIPT, { keys: [lockKey], arguments: [token] });
      if (['done', 'dead', 'retry'].includes(started?.[1])) await acknowledge(entry.id);
      return;
    }
    const attempt = Number(started[1]);
    let leaseLost = false;
    let renewalRunning = false;
    const heartbeat = setInterval(async () => {
      if (renewalRunning || leaseLost) return;
      renewalRunning = true;
      try {
        const renewed = await client.eval(RENEW_LEASE_SCRIPT, {
          keys: [lockKey],
          arguments: [token, String(leaseDuration)]
        });
        if (Number(renewed) !== 1) leaseLost = true;
      } catch (error) {
        leaseLost = true;
        logError('Telerivet SMS lease renewal failed:', error && error.message ? error.message : 'unknown error');
      } finally {
        renewalRunning = false;
      }
    }, Math.max(1000, Math.floor(leaseDuration / 3)));
    heartbeat.unref?.();

    try {
      const result = await runtime.handleInbound({
        from: message.from,
        text: message.text,
        messageId
      }, { retryDelivery: true });

      if (leaseLost) return;
      if (result?.accepted === false && ['invalid_sender', 'empty_message', 'invalid_message_id'].includes(result.reason)) {
        await failOrRetry(entry, jobKey, lockKey, token, attempt, {
          code: result.reason,
          message: 'The inbound SMS failed permanent validation.',
          retryable: false
        }, true);
        return;
      }
      if (result && result.accepted === false) {
        await completeJob(entry, jobKey, lockKey, token);
        return;
      }
      if (!await completeJob(entry, jobKey, lockKey, token)) {
        logError('Telerivet SMS job completion skipped after its lease was lost:', messageId);
      }
    } catch (error) {
      if (leaseLost) return;
      const outcome = await failOrRetry(entry, jobKey, lockKey, token, attempt, error);
      if (outcome === 'retry') logError('Telerivet SMS job scheduled for retry:', errorInfo(error).code);
      else if (outcome === 'dead') logError('Telerivet SMS job moved to dead letters:', errorInfo(error).code);
    } finally {
      clearInterval(heartbeat);
      try {
        await client.eval(RELEASE_LEASE_SCRIPT, { keys: [lockKey], arguments: [token] });
      } catch (error) {
        logError('Telerivet SMS lease release failed:', error && error.message ? error.message : 'unknown error');
      }
    }
  }

  async function readNewMessages() {
    const streams = await client.xReadGroup(
      GROUP,
      consumer,
      [{ key: STREAM, id: '>' }],
      { COUNT: 5, BLOCK: 1000 }
    );
    return (streams || []).flatMap((stream) => stream.messages || []);
  }

  async function reclaimMessages() {
    const claimed = await client.xAutoClaim(STREAM, GROUP, consumer, claimIdle, '0-0', { COUNT: 5 });
    return (claimed.messages || []).filter(Boolean);
  }

  async function runWorker() {
    while (!stopping) {
      try {
        await dispatchRetries();
        const pending = await reclaimMessages();
        const entries = pending.length ? pending : await readNewMessages();
        for (const entry of entries) {
          if (stopping) break;
          await processMessage(entry);
        }
      } catch (error) {
        if (!stopping) {
          logError('Telerivet SMS queue worker failed:', error && error.message ? error.message : 'unknown error');
          await delay(500);
        }
      }
    }
  }

  return {
    async enqueue({ messageId, from, text }) {
      if (!messageId || !from || !text) throw new Error('Telerivet message ID, sender, and text are required.');
      const result = await client.eval(ENQUEUE_SCRIPT, {
        keys: [dedupeKey(messageId), STREAM, stateKey(messageId)],
        arguments: [messageId, from, text, String(now())]
      });
      if (!Array.isArray(result) || result.length < 2) {
        throw new Error('Redis returned an invalid SMS queue response.');
      }
      return { duplicate: Number(result[0]) === 0, streamId: String(result[1]) };
    },

    async listFailed(limit = 50) {
      const count = Math.min(100, numberOption(limit, 50));
      const entries = await client.xRange(DEAD_STREAM, '-', '+', { COUNT: count });
      const failed = [];
      for (const entry of entries || []) {
        const state = await client.hGetAll(entry.message.job_key);
        if (state.status !== 'dead') continue;
        failed.push({
          messageId: state.message_id,
          from: state.from,
          text: state.text,
          attempts: Number(state.attempts) || 0,
          errorCode: state.error_code || 'sms_processing_error',
          error: state.last_error || '',
          failedAt: Number(state.failed_at) || 0
        });
      }
      return failed;
    },

    async retryFailed(messageId) {
      if (typeof messageId !== 'string' || !messageId.trim() || messageId.length > 128) {
        throw new Error('A valid Telerivet message ID is required.');
      }
      const trimmedId = messageId.trim();
      const key = stateKey(trimmedId);
      const result = await client.eval(RETRY_FAILED_SCRIPT, {
        keys: [key, dedupeKey(trimmedId), STREAM, DEAD_STREAM, RETRY_SET],
        arguments: [trimmedId, String(now())]
      });
      if (!Array.isArray(result) || result.length < 2) {
        throw new Error('Redis returned an invalid failed-message retry response.');
      }
      return { retried: Number(result[0]) === 1, status: String(result[1]) };
    },

    async start() {
      try {
        await client.xGroupCreate(STREAM, GROUP, '0', { MKSTREAM: true });
      } catch (error) {
        if (!String(error && error.message).includes('BUSYGROUP')) throw error;
      }
      if (!workerPromise) {
        stopping = false;
        workerPromise = runWorker().finally(() => { workerPromise = null; });
      }
    },

    async stop() {
      stopping = true;
      if (workerPromise) await workerPromise;
    }
  };
}
