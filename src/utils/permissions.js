export function hasAnyRole(member, roleIds = []) {
  if (!member || !Array.isArray(roleIds) || roleIds.length === 0) return false;
  return roleIds.some((roleId) => member.roles.cache.has(roleId));
}

export function isStaff(member, config, extraRoles = []) {
  const roleIds = [
    ...(config.permissions?.staffRoles ?? []),
    ...(config.permissions?.adminRoles ?? []),
    ...extraRoles,
  ];
  return hasAnyRole(member, roleIds) || member.permissions.has('Administrator');
}

export async function requireStaff(interaction, config, extraRoles = []) {
  if (isStaff(interaction.member, config, extraRoles)) return true;

  await interaction.reply({
    content: 'You do not have permission to use this.',
    ephemeral: true,
  });
  return false;
}
