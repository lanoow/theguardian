export const ids = {
  verificationButton: 'verification:verify',
  ticketOpen: (kind) => `ticket:open:${kind}`,
};

export function parseCustomId(customId) {
  const [scope, action, ...rest] = customId.split(':');
  return { scope, action, rest };
}
