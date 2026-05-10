export function parseDuration(value) {
  const text = String(value ?? '').trim().toLowerCase();
  const match = text.match(/^(\d+)\s*(m|min|minute|minutes|h|hr|hour|hours|d|day|days)$/);
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2][0];
  const multiplier = unit === 'd' ? 86_400_000 : unit === 'h' ? 3_600_000 : 60_000;
  return amount * multiplier;
}

export function formatDuration(ms) {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hours`;
  return `${Math.round(hours / 24)} days`;
}
