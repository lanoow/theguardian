import { ChannelType, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { requireStaff } from '../utils/permissions.js';

const refreshTimers = new Map();
const refreshPromises = new Map();
const baselinePromises = new Map();

function getConfig(ctx) {
  return ctx.config.modules.stats ?? {};
}

function snapshotFor(ctx, guildId) {
  return ctx.stores.stats.read().snapshots?.[guildId] ?? {};
}

function countStat(guild, ctx, stat) {
  if (stat.type === 'members') return guild.memberCount;

  const snapshot = snapshotFor(ctx, guild.id);
  if (Number.isInteger(snapshot[stat.key])) return snapshot[stat.key];

  if (stat.type === 'bots') return guild.members.cache.filter((member) => member.user.bot).size;
  if (stat.type === 'role') return guild.roles.cache.get(stat.roleId)?.members.size ?? 0;

  return 0;
}

async function listAllMembers(guild) {
  const members = [];
  let after = '0';

  for (;;) {
    const batch = await guild.members.list({ limit: 1000, after, cache: true });
    if (!batch.size) break;

    members.push(...batch.values());
    after = batch.last().id;
    if (batch.size < 1000) break;
  }

  return members;
}

async function buildStatsSnapshot(guild, ctx) {
  const config = getConfig(ctx);
  if (!config.enabled) return;

  const members = await listAllMembers(guild);
  const snapshot = {};

  for (const stat of config.channels ?? []) {
    if (stat.type === 'bots') {
      snapshot[stat.key] = members.filter((member) => member.user.bot).length;
    }

    if (stat.type === 'role') {
      snapshot[stat.key] = members.filter((member) => member.roles.cache.has(stat.roleId)).length;
    }
  }

  const store = ctx.stores.stats.read();
  store.snapshots ??= {};
  store.snapshots[guild.id] = snapshot;
  ctx.stores.stats.write(store);
}

async function buildStatsSnapshotOnce(guild, ctx) {
  const existing = baselinePromises.get(guild.id);
  if (existing) return existing;

  const promise = buildStatsSnapshot(guild, ctx)
    .finally(() => {
      baselinePromises.delete(guild.id);
    });
  baselinePromises.set(guild.id, promise);
  return promise;
}

async function refreshGuildStats(guild, ctx) {
  const config = getConfig(ctx);
  if (!config.enabled) return;

  const store = ctx.stores.stats.read();
  const channels = store.channels[guild.id] ?? {};

  for (const stat of config.channels ?? []) {
    const count = countStat(guild, ctx, stat);
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

function adjustSnapshot(guild, ctx, updater) {
  const config = getConfig(ctx);
  if (!config.enabled) return;

  ctx.stores.stats.update((store) => {
    store.snapshots ??= {};
    const snapshot = store.snapshots[guild.id] ?? {};
    store.snapshots[guild.id] = updater(snapshot, config.channels ?? []);
    return store;
  });
}

function memberHasRole(member, roleId) {
  return member.roles.cache.has(roleId);
}

function clampCount(value) {
  return Math.max(0, Number(value) || 0);
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
    await buildStatsSnapshotOnce(interaction.guild, ctx);
    await refreshGuildStatsOnce(interaction.guild, ctx);
    await interaction.editReply('Stats refreshed.');
    return true;
  },

  recordMemberAdd(member, ctx) {
    adjustSnapshot(member.guild, ctx, (snapshot, stats) => {
      for (const stat of stats) {
        if (stat.type === 'bots' && member.user.bot) {
          snapshot[stat.key] = clampCount(snapshot[stat.key]) + 1;
        }
        if (stat.type === 'role' && memberHasRole(member, stat.roleId)) {
          snapshot[stat.key] = clampCount(snapshot[stat.key]) + 1;
        }
      }
      return snapshot;
    });
    this.scheduleRefresh(member.guild, ctx);
  },

  recordMemberRemove(member, ctx) {
    adjustSnapshot(member.guild, ctx, (snapshot, stats) => {
      for (const stat of stats) {
        if (stat.type === 'bots' && member.user.bot) {
          snapshot[stat.key] = clampCount(clampCount(snapshot[stat.key]) - 1);
        }
        if (stat.type === 'role' && memberHasRole(member, stat.roleId)) {
          snapshot[stat.key] = clampCount(clampCount(snapshot[stat.key]) - 1);
        }
      }
      return snapshot;
    });
    this.scheduleRefresh(member.guild, ctx);
  },

  recordMemberUpdate(oldMember, newMember, ctx) {
    adjustSnapshot(newMember.guild, ctx, (snapshot, stats) => {
      for (const stat of stats) {
        if (stat.type !== 'role') continue;
        const hadRole = memberHasRole(oldMember, stat.roleId);
        const hasRole = memberHasRole(newMember, stat.roleId);

        if (!hadRole && hasRole) snapshot[stat.key] = clampCount(snapshot[stat.key]) + 1;
        if (hadRole && !hasRole) snapshot[stat.key] = clampCount(clampCount(snapshot[stat.key]) - 1);
      }
      return snapshot;
    });
    this.scheduleRefresh(newMember.guild, ctx);
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
        await buildStatsSnapshotOnce(guild, ctx).catch(() => null);
        await refreshGuildStats(guild, ctx).catch(() => null);
      }
    };

    await refreshAll();

    if (config.fallbackIntervalMinutes > 0) {
      setInterval(refreshAll, config.fallbackIntervalMinutes * 60_000);
    }
  },
};
