export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function truncate(value, length = 1024) {
  const text = String(value ?? '');
  if (text.length <= length) return text;
  return `${text.slice(0, length - 3)}...`;
}

export function slug(value) {
  return String(value ?? 'user')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'user';
}

export function formatDiscordTimestamp(date = new Date()) {
  return Math.floor(new Date(date).getTime() / 1000);
}
