import { ChannelType, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { requireStaff } from '../utils/permissions.js';

const refreshTimers = new Map();
const refreshPromises = new Map();

function getConfig(ctx) {
  return ctx.config.modules.stats ?? {};
}

function countStat(guild, stat) {
  if (stat.type === 'members') return guild.memberCount;

  if (stat.type === 'bots') return guild.members.cache.filter((member) => member.user.bot).size;
  if (stat.type === 'role') {
    return guild.roles.cache.get(stat.roleId)?.members.size ?? 0;
  }

  return 0;
}

async function refreshGuildStats(guild, ctx) {
  const config = getConfig(ctx);
  if (!config.enabled) return;

  const store = ctx.stores.stats.read();
  const channels = store.channels[guild.id] ?? {};

  for (const stat of config.channels ?? []) {
    const count = countStat(guild, stat);
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

async function refreshGuildStatsOnce(guild, ctx) {
  const existing = refreshPromises.get(guild.id);
  if (existing) return existing;

  const promise = refreshGuildStats(guild, ctx)
    .finally(() => {
      refreshPromises.delete(guild.id);
    });
  refreshPromises.set(guild.id, promise);
  return promise;
}

export const statsModule = {
  async handleCommand(interaction, ctx) {
    if (!await requireStaff(interaction, ctx.config)) return true;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await refreshGuildStatsOnce(interaction.guild, ctx);
    await interaction.editReply('Stats refreshed.');
    return true;
  },

  scheduleRefresh(guild, ctx, delayMs = 2_000) {
    const config = getConfig(ctx);
    if (!config.enabled || !guild) return;

    const existingTimer = refreshTimers.get(guild.id);
    if (existingTimer) clearTimeout(existingTimer);

    const timer = setTimeout(() => {
      refreshTimers.delete(guild.id);
      refreshGuildStatsOnce(guild, ctx).catch(() => null);
    }, delayMs);

    refreshTimers.set(guild.id, timer);
  },

  async refreshNow(guild, ctx) {
    await refreshGuildStatsOnce(guild, ctx);
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

    if (config.fallbackIntervalMinutes > 0) {
      setInterval(refreshAll, config.fallbackIntervalMinutes * 60_000);
    }
  },
};
