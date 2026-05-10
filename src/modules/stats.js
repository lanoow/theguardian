import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { requireStaff } from '../utils/permissions.js';

function getConfig(ctx) {
  return ctx.config.modules.stats ?? {};
}

async function countStat(guild, stat) {
  if (stat.type === 'members') return guild.memberCount;

  const members = await guild.members.fetch();
  if (stat.type === 'bots') return members.filter((member) => member.user.bot).size;
  if (stat.type === 'role') {
    return members.filter((member) => member.roles.cache.has(stat.roleId)).size;
  }

  return 0;
}

async function refreshGuildStats(guild, ctx) {
  const config = getConfig(ctx);
  if (!config.enabled) return;

  const store = ctx.stores.stats.read();
  const channels = store.channels[guild.id] ?? {};

  for (const stat of config.channels ?? []) {
    const count = await countStat(guild, stat);
    const name = stat.name.replaceAll('{count}', String(count));
    let channel = channels[stat.key] ? await guild.channels.fetch(channels[stat.key]).catch(() => null) : null;

    if (!channel) {
      channel = await guild.channels.create({
        name,
        type: ChannelType.GuildVoice,
        parent: config.categoryId,
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            deny: [PermissionFlagsBits.Connect],
          },
        ],
      });
      channels[stat.key] = channel.id;
    } else if (channel.name !== name) {
      await channel.setName(name).catch(() => null);
    }
  }

  store.channels[guild.id] = channels;
  ctx.stores.stats.write(store);
}

export const statsModule = {
  async handleCommand(interaction, ctx) {
    if (!await requireStaff(interaction, ctx.config)) return true;
    await interaction.deferReply({ ephemeral: true });
    await refreshGuildStats(interaction.guild, ctx);
    await interaction.editReply('Stats refreshed.');
    return true;
  },

  async ready(client, ctx) {
    const config = getConfig(ctx);
    if (!config.enabled) return;

    const refreshAll = async () => {
      for (const guild of client.guilds.cache.values()) {
        await refreshGuildStats(guild, ctx).catch(() => null);
      }
    };

    await refreshAll();
    setInterval(refreshAll, (config.updateIntervalMinutes ?? 10) * 60_000);
  },
};
