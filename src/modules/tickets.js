import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
} from 'discord.js';
import { auditLog } from '../services/audit-log.js';
import { createTranscript } from '../services/transcript.js';
import { runTextWizard, WizardTimeoutError } from '../services/wizard.js';
import { baseEmbed, buildFieldsEmbed } from '../utils/embed.js';
import { ids } from '../utils/ids.js';
import { isStaff, requireStaff } from '../utils/permissions.js';
import { slug, truncate } from '../utils/text.js';

function moduleConfig(ctx) {
  return ctx.config.modules.tickets ?? {};
}

function kindConfig(ctx, kind) {
  return moduleConfig(ctx)[kind];
}

function staffRoleIds(ctx, kind) {
  return kindConfig(ctx, kind)?.staffRoles ?? ctx.config.permissions?.staffRoles ?? [];
}

function categoryConfig(ctx, kind, categoryKey) {
  return (kindConfig(ctx, kind)?.categories ?? []).find((category) => category.key === categoryKey) ?? null;
}

function priorityConfig(ctx, priorityKey) {
  const priorities = moduleConfig(ctx).priorities ?? {};
  return priorities[priorityKey] ?? priorities.normal ?? { label: priorityKey ?? 'Normal', color: '#5865F2' };
}

function configuredPriorities(ctx) {
  const priorities = moduleConfig(ctx).priorities ?? {};
  const entries = Object.entries(priorities);
  if (entries.length) return entries;
  return [['normal', { label: 'Normal', color: '#5865F2' }]];
}

function ticketQuestions(ctx, kind, categoryKey) {
  const category = categoryConfig(ctx, kind, categoryKey);
  return category?.questions ?? kindConfig(ctx, kind)?.questions ?? [];
}

function ticketCategoryId(ctx, kind, categoryKey) {
  const category = categoryConfig(ctx, kind, categoryKey);
  return category?.categoryId ?? kindConfig(ctx, kind)?.categoryId;
}

function ticketStaffRoles(ctx, kind, categoryKey = null) {
  const category = categoryConfig(ctx, kind, categoryKey);
  return category?.staffRoles ?? staffRoleIds(ctx, kind);
}

function ticketMentionText(ctx, kind, openerId) {
  const roles = staffRoleIds(ctx, kind).map((roleId) => `<@&${roleId}>`).join(' ');
  return [`<@${openerId}>`, roles].filter(Boolean).join(' ');
}

function selectedTicketMentionText(ctx, kind, categoryKey, openerId) {
  const roles = ticketStaffRoles(ctx, kind, categoryKey).map((roleId) => `<@&${roleId}>`).join(' ');
  return [`<@${openerId}>`, roles].filter(Boolean).join(' ');
}

function buildPanel(ctx, kind) {
  const config = kindConfig(ctx, kind);
  const panel = config.panel ?? {};
  const embed = baseEmbed(ctx.config, {
    title: panel.title,
    description: panel.description,
    color: panel.color,
    image: panel.image,
    thumbnail: panel.thumbnail,
    timestamp: true,
  });
  const button = new ButtonBuilder()
    .setCustomId(ids.ticketOpen(kind))
    .setLabel(panel.buttonLabel ?? 'Open Ticket')
    .setStyle(kind === 'bugs' ? ButtonStyle.Danger : ButtonStyle.Primary);

  if (panel.buttonEmoji) button.setEmoji(panel.buttonEmoji);

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(button)],
  };
}

function savePanelMessage(ctx, kind, message) {
  ctx.stores.panels.update((data) => {
    data.panels[kind] = { channelId: message.channelId, messageId: message.id };
  });
}

function makeChannelName(template, user) {
  return (template ?? 'ticket-{username}')
    .replaceAll('{username}', slug(user.username))
    .replaceAll('{userid}', user.id)
    .slice(0, 90);
}

function addOrUpdateTicket(ctx, ticket) {
  ctx.stores.tickets.update((data) => {
    const index = data.tickets.findIndex((item) => item.id === ticket.id);
    if (index === -1) data.tickets.push(ticket);
    else data.tickets[index] = ticket;
  });
}

function getOpenTicketByChannel(ctx, channelId) {
  return ctx.stores.tickets.read().tickets.find((ticket) => ticket.channelId === channelId && ticket.status !== 'closed');
}

function getTicketById(ctx, ticketId) {
  return ctx.stores.tickets.read().tickets.find((ticket) => ticket.id === ticketId);
}

function blacklist(ctx) {
  const store = ctx.stores.tickets.read();
  return new Set([
    ...(moduleConfig(ctx).settings?.blacklistUserIds ?? []),
    ...(store.blacklistUserIds ?? []),
  ]);
}

function isBlacklisted(ctx, userId) {
  return blacklist(ctx).has(userId);
}

function cooldownRemainingMs(ctx, kind, userId) {
  const cooldownMinutes = moduleConfig(ctx).settings?.cooldownMinutes ?? 0;
  if (!cooldownMinutes) return 0;

  const latest = ctx.stores.tickets.read().tickets
    .filter((ticket) => ticket.kind === kind && ticket.openerId === userId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  if (!latest) return 0;

  const expiresAt = new Date(latest.createdAt).getTime() + cooldownMinutes * 60_000;
  return Math.max(0, expiresAt - Date.now());
}

function formatRemaining(ms) {
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.ceil(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

async function respondEphemeral(interaction, content, options = {}) {
  const payload = { content, components: [], flags: MessageFlags.Ephemeral, ...options };
  if (interaction.deferred || interaction.replied) {
    const { flags, ...editPayload } = payload;
    await interaction.editReply(editPayload);
  } else {
    await interaction.reply(payload);
  }
}

function ticketPermissionOverwrites(guild, userId, staffRoles) {
  return [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: userId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
      ],
    },
    ...staffRoles.map((roleId) => ({
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ManageMessages,
      ],
    })),
  ];
}

async function ensureTicketChannelPermissions(channel, guild, userId, staffRoles) {
  await channel.permissionOverwrites.set(ticketPermissionOverwrites(guild, userId, staffRoles));
}

async function deleteTicketChannel(channel) {
  await new Promise((resolve) => {
    setTimeout(resolve, 2_000);
  });
  await channel.delete('Ticket closed and transcript delivered.').catch(() => null);
}

async function closeTicketChannel({ channel, guild, client, ctx, ticket, closeInfo, deleteChannel = true }) {
  const root = moduleConfig(ctx);
  const config = kindConfig(ctx, ticket.kind);
  const transcript = await createTranscript(channel, ticket, closeInfo, {
    transcriptDir: ctx.transcriptDir,
    limit: root.settings?.transcriptFetchLimit ?? 1000,
  });
  const transcriptChannel = await guild.channels.fetch(config.transcriptChannelId).catch(() => null);

  let transcriptUrl = null;
  if (transcriptChannel?.isTextBased()) {
    const staffMessage = await transcriptChannel.send({
      embeds: [closeEmbed(ctx, ticket, closeInfo, null)],
      files: [new AttachmentBuilder(transcript.filePath, { name: transcript.fileName })],
    });
    transcriptUrl = staffMessage.attachments.first()?.url ?? null;
    if (transcriptUrl) {
      await staffMessage.edit({ embeds: [closeEmbed(ctx, ticket, closeInfo, transcriptUrl)] }).catch(() => null);
    }
  }

  const opener = await client.users.fetch(ticket.openerId).catch(() => null);
  if (opener) {
    const ratingRow = new ActionRowBuilder().addComponents(
      [1, 2, 3, 4, 5].map((rating) =>
        new ButtonBuilder()
          .setCustomId(`ticket:rating:${ticket.id}:${rating}`)
          .setLabel(String(rating))
          .setStyle(ButtonStyle.Secondary)
      )
    );

    await opener.send({
      embeds: [closeEmbed(ctx, ticket, closeInfo, transcriptUrl)],
      components: [ratingRow],
      files: [new AttachmentBuilder(transcript.filePath, { name: transcript.fileName })],
    }).catch(() => null);
  }

  ticket.status = 'closed';
  ticket.closedAt = closeInfo.closedAt;
  ticket.closedById = closeInfo.closedById;
  ticket.closeReason = closeInfo.reason;
  ticket.closeResult = closeInfo.resultLabel;
  ticket.transcriptPath = transcript.filePath;
  ticket.transcriptUrl = transcriptUrl;
  addOrUpdateTicket(ctx, ticket);

  await auditLog(guild, ctx, {
    kind: ticket.kind,
    title: 'Ticket closed',
    color: closeInfo.result === 'resolved' ? '#57F287' : '#ED4245',
    fields: [
      { name: 'Ticket ID', value: ticket.id, inline: false },
      { name: 'Opened by', value: `<@${ticket.openerId}>`, inline: true },
      { name: 'Closed by', value: closeInfo.closedById ? `<@${closeInfo.closedById}>` : 'System', inline: true },
      { name: 'Result', value: closeInfo.resultLabel, inline: true },
      { name: 'Reason', value: truncate(closeInfo.reason, 1024), inline: false },
    ],
  });

  if (deleteChannel) await deleteTicketChannel(channel);
  return { transcriptUrl };
}

function closeEmbed(ctx, ticket, closeInfo, transcriptUrl) {
  const fields = [
    { name: 'Ticket ID', value: ticket.id, inline: false },
    { name: 'Opened by', value: `<@${ticket.openerId}>`, inline: true },
    { name: 'Closed by', value: closeInfo.closedById ? `<@${closeInfo.closedById}>` : 'System', inline: true },
    { name: 'Result', value: closeInfo.resultLabel, inline: true },
    { name: 'Reason', value: truncate(closeInfo.reason, 1024), inline: false },
  ];
  if (transcriptUrl) {
    fields.push({ name: 'Transcript', value: `[Open transcript](${transcriptUrl})`, inline: false });
  }
  return buildFieldsEmbed(ctx.config, {
    title: 'Ticket closed',
    color: closeInfo.result === 'resolved' ? '#57F287' : '#ED4245',
    timestamp: true,
  }, fields);
}

function ticketDetailsFields(ctx, ticket) {
  const category = categoryConfig(ctx, ticket.kind, ticket.categoryKey);
  const priority = priorityConfig(ctx, ticket.priority);
  return [
    { name: 'Ticket ID', value: ticket.id, inline: true },
    { name: 'Category', value: category?.label ?? ticket.categoryKey ?? 'General', inline: true },
    { name: 'Priority', value: priority.label ?? ticket.priority ?? 'Normal', inline: true },
    { name: 'Claimed by', value: ticket.claimedById ? `<@${ticket.claimedById}>` : 'Unclaimed', inline: true },
  ];
}

function categorySelect(ctx, kind) {
  const categories = kindConfig(ctx, kind)?.categories ?? [];
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`ticket:category:${kind}`)
      .setPlaceholder('Choose a category')
      .addOptions(categories.map((category) => ({
        label: category.label,
        value: category.key,
        description: category.description?.slice(0, 100),
      })))
  );
}

function prioritySelect(ctx, kind, categoryKey) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`ticket:priority:${kind}:${categoryKey ?? 'general'}`)
      .setPlaceholder('Choose a priority')
      .addOptions(configuredPriorities(ctx).map(([key, priority]) => ({
        label: priority.label ?? key,
        value: key,
        description: priority.description?.slice(0, 100) ?? `Set priority to ${priority.label ?? key}`,
      })))
  );
}

async function createTicketFromInteraction(interaction, ctx, kind, categoryKey = null, priority = 'normal') {
  const root = moduleConfig(ctx);
  const config = kindConfig(ctx, kind);
  if (!root.enabled || !config) {
    await respondEphemeral(interaction, 'Tickets are currently disabled.');
    return;
  }

  if (isBlacklisted(ctx, interaction.user.id)) {
    await respondEphemeral(interaction, 'You are blocked from opening tickets.');
    return;
  }

  const cooldownMs = cooldownRemainingMs(ctx, kind, interaction.user.id);
  if (cooldownMs > 0) {
    await respondEphemeral(interaction, `Please wait ${formatRemaining(cooldownMs)} before opening another ticket.`);
    return;
  }

  const existing = ctx.stores.tickets.read().tickets.find((ticket) =>
    ticket.openerId === interaction.user.id &&
    ticket.kind === kind &&
    ticket.status !== 'closed'
  );
  if (existing) {
    await respondEphemeral(interaction, `You already have an open ${kind === 'bugs' ? 'bug report' : 'ticket'}: <#${existing.channelId}>`);
    return;
  }

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }

  const staffRolesForTicket = ticketStaffRoles(ctx, kind, categoryKey);
  const channel = await interaction.guild.channels.create({
    name: makeChannelName(config.channelName, interaction.user),
    type: ChannelType.GuildText,
    parent: ticketCategoryId(ctx, kind, categoryKey),
    topic: `${kind} ticket opened by ${interaction.user.tag} (${interaction.user.id})`,
    permissionOverwrites: ticketPermissionOverwrites(interaction.guild, interaction.user.id, staffRolesForTicket),
  });
  await ensureTicketChannelPermissions(channel, interaction.guild, interaction.user.id, staffRolesForTicket);

  const ticket = {
    id: `${kind}-${channel.id}`,
    kind,
    channelId: channel.id,
    guildId: interaction.guildId,
    openerId: interaction.user.id,
    openerTag: interaction.user.tag,
    categoryKey,
    priority,
    status: 'questioning',
    createdAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    answers: [],
  };
  addOrUpdateTicket(ctx, ticket);

  await auditLog(interaction.guild, ctx, {
    kind,
    title: `${kind === 'bugs' ? 'Bug report' : 'Ticket'} opened`,
    fields: [
      { name: 'Ticket ID', value: ticket.id, inline: false },
      { name: 'Opened by', value: `<@${ticket.openerId}>`, inline: true },
      { name: 'Channel', value: `<#${channel.id}>`, inline: true },
      ...ticketDetailsFields(ctx, ticket),
    ],
  });

  await respondEphemeral(interaction, `Created ${channel}. Please answer the questions there.`);
  await channel.send({
    content: selectedTicketMentionText(ctx, kind, categoryKey, interaction.user.id),
    embeds: [buildFieldsEmbed(ctx.config, {
      title: kind === 'bugs' ? 'Bug report opened' : 'Support ticket opened',
      description: 'Please answer the following questions. Your setup messages will be cleaned up afterward.',
      color: priorityConfig(ctx, priority).color ?? config.panel?.color,
      timestamp: true,
    }, ticketDetailsFields(ctx, ticket))],
  });

  try {
    const timeoutMs = (root.settings?.questionTimeoutMinutes ?? 20) * 60_000;
    ticket.answers = await runTextWizard(channel, interaction.user, ticketQuestions(ctx, kind, categoryKey), {
      timeoutMs,
      deleteMessages: true,
    });
    ticket.status = 'open';
    ticket.lastActivityAt = new Date().toISOString();
    addOrUpdateTicket(ctx, ticket);

    const fields = [
      ...ticketDetailsFields(ctx, ticket),
      ...ticket.answers.map((item, index) => ({
        name: `${index + 1}. ${truncate(item.question, 250)}`,
        value: truncate(item.answer, 1024),
      })),
    ];

    await channel.send({
      content: selectedTicketMentionText(ctx, kind, categoryKey, interaction.user.id),
      embeds: [buildFieldsEmbed(ctx.config, {
        title: 'Ticket details',
        description: 'The opener has completed the intake questions.',
        color: priorityConfig(ctx, priority).color ?? config.panel?.color,
        timestamp: true,
      }, fields)],
    });
  } catch (error) {
    ticket.status = 'open';
    ticket.questionTimeout = error instanceof WizardTimeoutError;
    ticket.lastActivityAt = new Date().toISOString();
    addOrUpdateTicket(ctx, ticket);
    await channel.send('The question flow timed out. Staff can continue manually.');
  }
}

async function showOpenFlow(interaction, ctx, kind) {
  const categories = kindConfig(ctx, kind)?.categories ?? [];
  if (categories.length) {
    await interaction.reply({
      content: 'Choose a ticket category.',
      components: [categorySelect(ctx, kind)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (configuredPriorities(ctx).length > 1) {
    await interaction.reply({
      content: 'Choose a ticket priority.',
      components: [prioritySelect(ctx, kind, 'general')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await createTicketFromInteraction(interaction, ctx, kind, null, 'normal');
}

export const ticketsModule = {
  async ready(client, ctx) {
    const inactivity = moduleConfig(ctx).settings?.inactivity ?? {};
    if (!inactivity.autoCloseMinutes) return;

    const checkInactive = async () => {
      const now = Date.now();
      const tickets = ctx.stores.tickets.read().tickets.filter((ticket) => ticket.status === 'open');
      for (const ticket of tickets) {
        const lastActivityAt = new Date(ticket.lastActivityAt ?? ticket.createdAt).getTime();
        const inactiveMinutes = (now - lastActivityAt) / 60_000;
        const guild = client.guilds.cache.get(ticket.guildId);
        const channel = guild ? await guild.channels.fetch(ticket.channelId).catch(() => null) : null;
        if (!guild || !channel?.isTextBased()) continue;

        if (inactivity.warningMinutes && inactiveMinutes >= inactivity.warningMinutes && !ticket.inactivityWarnedAt) {
          ticket.inactivityWarnedAt = new Date().toISOString();
          addOrUpdateTicket(ctx, ticket);
          await channel.send(`This ticket has been inactive and will be closed after ${inactivity.autoCloseMinutes} minutes of inactivity unless someone replies.`);
        }

        if (inactiveMinutes >= inactivity.autoCloseMinutes) {
          await closeTicketChannel({
            channel,
            guild,
            client,
            ctx,
            ticket,
            closeInfo: {
              closedById: null,
              closedByTag: 'System',
              reason: 'Ticket automatically closed due to inactivity.',
              result: 'other',
              resultLabel: 'auto-closed',
              closedAt: new Date().toISOString(),
            },
          });
        }
      }
    };

    setInterval(checkInactive, 60_000);
  },

  async handleMessage(message, ctx) {
    const ticket = getOpenTicketByChannel(ctx, message.channelId);
    if (!ticket) return false;

    ticket.lastActivityAt = new Date().toISOString();
    ticket.inactivityWarnedAt = null;
    addOrUpdateTicket(ctx, ticket);
    return true;
  },

  async handleRatingButton(interaction, ctx) {
    if (!interaction.customId.startsWith('ticket:rating:')) return false;
    const [, , ticketId, rating] = interaction.customId.split(':');
    const ticket = getTicketById(ctx, ticketId);
    if (!ticket || ticket.openerId !== interaction.user.id) {
      await interaction.reply({ content: 'This rating is not available for you.', flags: MessageFlags.Ephemeral });
      return true;
    }

    ticket.rating = Number(rating);
    ticket.ratedAt = new Date().toISOString();
    addOrUpdateTicket(ctx, ticket);
    await interaction.update({ content: `Thanks for rating this ticket ${rating}/5.`, components: [] });
    await auditLog(interaction.client, ctx, {
      kind: ticket.kind,
      title: 'Ticket rated',
      fields: [
        { name: 'Ticket ID', value: ticket.id, inline: false },
        { name: 'Rating', value: `${rating}/5`, inline: true },
        { name: 'User', value: `<@${interaction.user.id}>`, inline: true },
      ],
    });
    return true;
  },

  async postPanel(interaction, ctx) {
    if (!await requireStaff(interaction, ctx.config)) return;

    const root = moduleConfig(ctx);
    const kind = interaction.options.getString('kind', true);
    const config = kindConfig(ctx, kind);

    if (!root.enabled || !config) {
      await interaction.reply({ content: 'This ticket panel is disabled or not configured.', flags: MessageFlags.Ephemeral });
      return;
    }

    const channel = interaction.options.getChannel('channel') ??
      await interaction.guild.channels.fetch(config.panelChannelId).catch(() => null);

    if (!channel?.isTextBased()) {
      await interaction.reply({ content: 'Panel channel is not configured or cannot be found.', flags: MessageFlags.Ephemeral });
      return;
    }

    const message = await channel.send(buildPanel(ctx, kind));
    savePanelMessage(ctx, kind, message);
    await interaction.reply({ content: `${kind === 'bugs' ? 'Bug' : 'Support'} panel posted in ${channel}.`, flags: MessageFlags.Ephemeral });
  },

  async refreshPanel(interaction, ctx) {
    if (!await requireStaff(interaction, ctx.config)) return;
    const kind = interaction.options.getString('panel', true);
    if (!['support', 'bugs'].includes(kind)) return false;

    const panel = ctx.stores.panels.read().panels[kind];
    if (!panel) {
      await interaction.reply({ content: `No stored ${kind} panel found. Use /setup ticket-panel first.`, flags: MessageFlags.Ephemeral });
      return true;
    }

    const channel = await interaction.guild.channels.fetch(panel.channelId).catch(() => null);
    const message = channel?.isTextBased() ? await channel.messages.fetch(panel.messageId).catch(() => null) : null;
    if (!message) {
      await interaction.reply({ content: `Stored ${kind} panel message no longer exists. Use /setup ticket-panel first.`, flags: MessageFlags.Ephemeral });
      return true;
    }

    await message.edit(buildPanel(ctx, kind));
    await interaction.reply({ content: `${kind === 'bugs' ? 'Bug' : 'Support'} panel refreshed.`, flags: MessageFlags.Ephemeral });
    return true;
  },

  async handleButton(interaction, ctx) {
    if (!interaction.customId.startsWith('ticket:open:')) return false;

    const kind = interaction.customId.split(':')[2];
    const config = kindConfig(ctx, kind);
    if (!moduleConfig(ctx).enabled || !config) {
      await interaction.reply({ content: 'Tickets are currently disabled.', flags: MessageFlags.Ephemeral });
      return true;
    }

    await showOpenFlow(interaction, ctx, kind);
    return true;
  },

  async handleSelect(interaction, ctx) {
    if (!interaction.customId.startsWith('ticket:')) return false;
    const [scope, action, kind, categoryKey] = interaction.customId.split(':');
    if (scope !== 'ticket') return false;

    if (action === 'category') {
      const selectedCategory = interaction.values[0];
      await interaction.update({
        content: 'Choose a ticket priority.',
        components: [prioritySelect(ctx, kind, selectedCategory)],
      });
      return true;
    }

    if (action === 'priority') {
      await interaction.deferUpdate();
      await createTicketFromInteraction(interaction, ctx, kind, categoryKey === 'general' ? null : categoryKey, interaction.values[0]);
      return true;
    }

    return false;
  },

  async handleCommand(interaction, ctx) {
    const group = interaction.options.getSubcommandGroup(false);
    const subcommand = interaction.options.getSubcommand();

    if (group === 'blacklist') {
      if (!await requireStaff(interaction, ctx.config)) return true;
      const user = interaction.options.getUser('user', true);
      ctx.stores.tickets.update((data) => {
        data.blacklistUserIds ??= [];
        if (subcommand === 'add' && !data.blacklistUserIds.includes(user.id)) data.blacklistUserIds.push(user.id);
        if (subcommand === 'remove') data.blacklistUserIds = data.blacklistUserIds.filter((id) => id !== user.id);
      });
      await interaction.reply({
        content: subcommand === 'add' ? `${user.tag} is blocked from opening tickets.` : `${user.tag} can open tickets again.`,
        flags: MessageFlags.Ephemeral,
      });
      await auditLog(interaction.guild, ctx, {
        title: 'Ticket blacklist updated',
        fields: [
          { name: 'Action', value: subcommand, inline: true },
          { name: 'User', value: `<@${user.id}>`, inline: true },
          { name: 'Staff', value: `<@${interaction.user.id}>`, inline: true },
        ],
      });
      return true;
    }

    if (subcommand === 'reopen') {
      if (!await requireStaff(interaction, ctx.config)) return true;
      const ticketId = interaction.options.getString('ticket_id', true);
      const ticket = getTicketById(ctx, ticketId);
      if (!ticket || ticket.status !== 'closed') {
        await interaction.reply({ content: 'Closed ticket not found.', flags: MessageFlags.Ephemeral });
        return true;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const opener = await interaction.client.users.fetch(ticket.openerId).catch(() => null);
      const member = opener ? await interaction.guild.members.fetch(opener.id).catch(() => null) : null;
      if (!member) {
        await interaction.editReply('The original opener is no longer in this server.');
        return true;
      }

      const staffRolesForTicket = ticketStaffRoles(ctx, ticket.kind, ticket.categoryKey);
      const config = kindConfig(ctx, ticket.kind);
      const channel = await interaction.guild.channels.create({
        name: makeChannelName(config.channelName, opener),
        type: ChannelType.GuildText,
        parent: ticketCategoryId(ctx, ticket.kind, ticket.categoryKey),
        topic: `${ticket.kind} ticket reopened from ${ticket.id}`,
        permissionOverwrites: ticketPermissionOverwrites(interaction.guild, opener.id, staffRolesForTicket),
      });
      await ensureTicketChannelPermissions(channel, interaction.guild, opener.id, staffRolesForTicket);

      const reopened = {
        ...ticket,
        id: `${ticket.kind}-${channel.id}`,
        previousTicketId: ticket.id,
        channelId: channel.id,
        status: 'open',
        reopenedAt: new Date().toISOString(),
        reopenedById: interaction.user.id,
        lastActivityAt: new Date().toISOString(),
      };
      addOrUpdateTicket(ctx, reopened);
      await channel.send({
        content: selectedTicketMentionText(ctx, reopened.kind, reopened.categoryKey, reopened.openerId),
        embeds: [buildFieldsEmbed(ctx.config, {
          title: 'Ticket reopened',
          description: `Reopened from ticket \`${ticket.id}\`.`,
          color: priorityConfig(ctx, reopened.priority).color,
          timestamp: true,
        }, ticketDetailsFields(ctx, reopened))],
      });
      await interaction.editReply(`Reopened as ${channel}.`);
      return true;
    }

    const ticket = getOpenTicketByChannel(ctx, interaction.channelId);
    if (!ticket) {
      await interaction.reply({ content: 'This command must be run inside an open ticket channel.', flags: MessageFlags.Ephemeral });
      return true;
    }

    if (!isStaff(interaction.member, ctx.config, ticketStaffRoles(ctx, ticket.kind, ticket.categoryKey))) {
      await interaction.reply({ content: 'Only staff can close tickets.', flags: MessageFlags.Ephemeral });
      return true;
    }

    if (subcommand === 'claim') {
      ticket.claimedById = interaction.user.id;
      ticket.claimedByTag = interaction.user.tag;
      ticket.claimedAt = new Date().toISOString();
      addOrUpdateTicket(ctx, ticket);
      await interaction.reply({ embeds: [buildFieldsEmbed(ctx.config, {
        title: 'Ticket claimed',
        description: `${interaction.user} claimed this ticket.`,
        color: priorityConfig(ctx, ticket.priority).color,
        timestamp: true,
      }, ticketDetailsFields(ctx, ticket))] });
      await auditLog(interaction.guild, ctx, {
        kind: ticket.kind,
        title: 'Ticket claimed',
        fields: [
          { name: 'Ticket ID', value: ticket.id, inline: false },
          { name: 'Claimed by', value: `<@${interaction.user.id}>`, inline: true },
        ],
      });
      return true;
    }

    if (subcommand === 'priority') {
      const level = interaction.options.getString('level', true);
      ticket.priority = level;
      ticket.priorityUpdatedById = interaction.user.id;
      addOrUpdateTicket(ctx, ticket);
      await interaction.reply({ embeds: [buildFieldsEmbed(ctx.config, {
        title: 'Ticket priority updated',
        description: `Priority changed to **${priorityConfig(ctx, level).label ?? level}**.`,
        color: priorityConfig(ctx, level).color,
        timestamp: true,
      }, ticketDetailsFields(ctx, ticket))] });
      return true;
    }

    if (subcommand !== 'close') return false;

    const result = interaction.options.getString('result', true);
    const reason = interaction.options.getString('reason', true);
    const other = interaction.options.getString('other_result');
    if (result === 'other' && !other) {
      await interaction.reply({ content: '`other_result` is required when result is Other.', flags: MessageFlags.Ephemeral });
      return true;
    }

    await interaction.deferReply();

    const closeInfo = {
      closedById: interaction.user.id,
      closedByTag: interaction.user.tag,
      reason,
      result,
      resultLabel: result === 'other' ? other : result,
      closedAt: new Date().toISOString(),
    };

    const { transcriptUrl } = await closeTicketChannel({
      channel: interaction.channel,
      guild: interaction.guild,
      client: interaction.client,
      ctx,
      ticket,
      closeInfo,
      deleteChannel: false,
    });
    await interaction.editReply({ embeds: [closeEmbed(ctx, ticket, closeInfo, transcriptUrl)] });
    await deleteTicketChannel(interaction.channel);
    return true;
  },
};
