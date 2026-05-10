function write(level, args) {
  const timestamp = new Date().toISOString();
  console[level](`[${timestamp}]`, ...args);
}

export const logger = {
  info: (...args) => write('log', args),
  warn: (...args) => write('warn', args),
  error: (...args) => write('error', args),
};
