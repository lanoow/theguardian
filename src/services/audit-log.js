import { EmbedBuilder } from 'discord.js';

function auditChannelId(ctx, kind = null) {
  if (kind) {
    const ticketConfig = ctx.config.modules.tickets?.[kind];
    if (ticketConfig?.auditLogChannelId) return ticketConfig.auditLogChannelId;
  }

  return ctx.config.bot?.auditLogChannelId;
}

export async function auditLog(clientOrGuild, ctx, event) {
  const guild = clientOrGuild.guilds ? clientOrGuild.guilds.cache.first() : clientOrGuild;
  const channelId = auditChannelId(ctx, event.kind);
  if (!guild || !channelId) return;

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setTitle(event.title)
    .setColor(event.color ?? ctx.config.bot?.defaultColor ?? '#5865F2')
    .setTimestamp(new Date());

  if (event.description) embed.setDescription(event.description);
  if (event.fields?.length) embed.addFields(event.fields);

  await channel.send({ embeds: [embed] }).catch(() => null);
}
