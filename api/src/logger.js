// Thin levelled logger (CONSTITUTION.md Logging Policy). Never pass patient
// data, credentials, keys, or JWTs to it.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[process.env.LOG_LEVEL ?? 'info'] ?? LEVELS.info;

function emit(level, message, context) {
  if (LEVELS[level] < threshold) return;
  const line = context ? `${message} ${JSON.stringify(context)}` : message;
  const write = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
  write(`${new Date().toISOString()} ${level.toUpperCase()} ${line}`);
}

export const logger = {
  debug: (message, context) => emit('debug', message, context),
  info: (message, context) => emit('info', message, context),
  warn: (message, context) => emit('warn', message, context),
  error: (message, context) => emit('error', message, context),
};
