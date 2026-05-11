import { logger } from '../core/logger.js';

const PLACEHOLDER_PATTERN = /^[A-Z0-9_]+_ID$/;

function isMissingId(value) {
  return !value || PLACEHOLDER_PATTERN.test(String(value));
}

async function checkChannel(guild, label, id, required = true) {
  if (isMissingId(id)) {
    if (required) logger.warn(`Config validation: ${label} is not configured.`);
    return;
  }

  const channel = await guild.channels.fetch(id).catch(() => null);
  if (!channel) logger.warn(`Config validation: ${label} points to missing channel/category ${id}.`);
}

function checkRole(guild, label, id, required = true) {
  if (isMissingId(id)) {
    if (required) logger.warn(`Config validation: ${label} is not configured.`);
    return;
  }

  if (!guild.roles.cache.has(id)) {
    logger.warn(`Config validation: ${label} points to missing role ${id}.`);
  }
}

export async function validateConfig(client, ctx) {
  for (const guild of client.guilds.cache.values()) {
    const verification = ctx.config.modules.verification ?? {};
    if (verification.enabled) {
      await checkChannel(guild, 'verification.verificationChannelId', verification.verificationChannelId);
      checkRole(guild, 'verification.joinRoleId', verification.joinRoleId, false);
      checkRole(guild, 'verification.verifiedRoleId', verification.verifiedRoleId);
    }

    const ticketRoot = ctx.config.modules.tickets ?? {};
    if (ticketRoot.enabled) {
      for (const kind of ['support', 'bugs']) {
        const config = ticketRoot[kind];
        if (!config) continue;
        await checkChannel(guild, `tickets.${kind}.panelChannelId`, config.panelChannelId);
        await checkChannel(guild, `tickets.${kind}.categoryId`, config.categoryId);
        await checkChannel(guild, `tickets.${kind}.transcriptChannelId`, config.transcriptChannelId);
        await checkChannel(guild, `tickets.${kind}.auditLogChannelId`, config.auditLogChannelId, false);
        for (const roleId of config.staffRoles ?? []) checkRole(guild, `tickets.${kind}.staffRoles`, roleId);
      }
    }

    const stats = ctx.config.modules.stats ?? {};
    if (stats.enabled) {
      await checkChannel(guild, 'stats.categoryId', stats.categoryId);
      for (const stat of stats.channels ?? []) {
        if (stat.type === 'role') checkRole(guild, `stats.channels.${stat.key}.roleId`, stat.roleId);
      }
    }

    await checkChannel(guild, 'bot.auditLogChannelId', ctx.config.bot?.auditLogChannelId, false);
  }
}
