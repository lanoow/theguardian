import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
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

function ticketMentionText(ctx, kind, openerId) {
  const roles = staffRoleIds(ctx, kind).map((roleId) => `<@&${roleId}>`).join(' ');
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

function closeEmbed(ctx, ticket, closeInfo, transcriptUrl) {
  const fields = [
    { name: 'Opened by', value: `<@${ticket.openerId}>`, inline: true },
    { name: 'Closed by', value: `<@${closeInfo.closedById}>`, inline: true },
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

export const ticketsModule = {
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

    await channel.send(buildPanel(ctx, kind));
    await interaction.reply({ content: `${kind === 'bugs' ? 'Bug' : 'Support'} panel posted in ${channel}.`, flags: MessageFlags.Ephemeral });
  },

  async handleButton(interaction, ctx) {
    if (!interaction.customId.startsWith('ticket:open:')) return false;

    const kind = interaction.customId.split(':')[2];
    const root = moduleConfig(ctx);
    const config = kindConfig(ctx, kind);
    if (!root.enabled || !config) {
      await interaction.reply({ content: 'Tickets are currently disabled.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const existing = ctx.stores.tickets.read().tickets.find((ticket) =>
      ticket.openerId === interaction.user.id &&
      ticket.kind === kind &&
      ticket.status !== 'closed'
    );
    if (existing) {
      await interaction.reply({ content: `You already have an open ${kind === 'bugs' ? 'bug report' : 'ticket'}: <#${existing.channelId}>`, flags: MessageFlags.Ephemeral });
      return true;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const ticketStaffRoles = staffRoleIds(ctx, kind);

    const channel = await interaction.guild.channels.create({
      name: makeChannelName(config.channelName, interaction.user),
      type: ChannelType.GuildText,
      parent: config.categoryId,
      topic: `${kind} ticket opened by ${interaction.user.tag} (${interaction.user.id})`,
      permissionOverwrites: ticketPermissionOverwrites(interaction.guild, interaction.user.id, ticketStaffRoles),
    });
    await ensureTicketChannelPermissions(channel, interaction.guild, interaction.user.id, ticketStaffRoles);

    const ticket = {
      id: `${kind}-${channel.id}`,
      kind,
      channelId: channel.id,
      guildId: interaction.guildId,
      openerId: interaction.user.id,
      openerTag: interaction.user.tag,
      status: 'questioning',
      createdAt: new Date().toISOString(),
      answers: [],
    };
    addOrUpdateTicket(ctx, ticket);

    await interaction.editReply(`Created ${channel}. Please answer the questions there.`);
    await channel.send({
      content: ticketMentionText(ctx, kind, interaction.user.id),
      embeds: [baseEmbed(ctx.config, {
        title: kind === 'bugs' ? 'Bug report opened' : 'Support ticket opened',
        description: 'Please answer the following questions. Your setup messages will be cleaned up afterward.',
        color: config.panel?.color,
        timestamp: true,
      })],
    });

    try {
      const timeoutMs = (root.settings?.questionTimeoutMinutes ?? 20) * 60_000;
      ticket.answers = await runTextWizard(channel, interaction.user, config.questions ?? [], {
        timeoutMs,
        deleteMessages: true,
      });
      ticket.status = 'open';
      addOrUpdateTicket(ctx, ticket);

      const fields = ticket.answers.map((item, index) => ({
        name: `${index + 1}. ${truncate(item.question, 250)}`,
        value: truncate(item.answer, 1024),
      }));

      await channel.send({
        content: ticketMentionText(ctx, kind, interaction.user.id),
        embeds: [buildFieldsEmbed(ctx.config, {
          title: 'Ticket details',
          description: 'The opener has completed the intake questions.',
          color: config.panel?.color,
          timestamp: true,
        }, fields)],
      });
    } catch (error) {
      ticket.status = 'open';
      ticket.questionTimeout = error instanceof WizardTimeoutError;
      addOrUpdateTicket(ctx, ticket);
      await channel.send('The question flow timed out. Staff can continue manually.');
    }

    return true;
  },

  async handleCommand(interaction, ctx) {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand !== 'close') return false;

    const ticket = getOpenTicketByChannel(ctx, interaction.channelId);
    if (!ticket) {
      await interaction.reply({ content: 'This command must be run inside an open ticket channel.', flags: MessageFlags.Ephemeral });
      return true;
    }

    if (!isStaff(interaction.member, ctx.config, staffRoleIds(ctx, ticket.kind))) {
      await interaction.reply({ content: 'Only staff can close tickets.', flags: MessageFlags.Ephemeral });
      return true;
    }

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

    const root = moduleConfig(ctx);
    const config = kindConfig(ctx, ticket.kind);
    const transcript = await createTranscript(interaction.channel, ticket, closeInfo, {
      transcriptDir: ctx.transcriptDir,
      limit: root.settings?.transcriptFetchLimit ?? 1000,
    });
    const attachment = new AttachmentBuilder(transcript.filePath, { name: transcript.fileName });
    const transcriptChannel = await interaction.guild.channels.fetch(config.transcriptChannelId).catch(() => null);

    let transcriptUrl = null;
    if (transcriptChannel?.isTextBased()) {
      const staffMessage = await transcriptChannel.send({
        embeds: [closeEmbed(ctx, ticket, closeInfo, null)],
        files: [attachment],
      });
      transcriptUrl = staffMessage.attachments.first()?.url ?? null;
      if (transcriptUrl) {
        await staffMessage.edit({ embeds: [closeEmbed(ctx, ticket, closeInfo, transcriptUrl)] }).catch(() => null);
      }
    }

    const opener = await interaction.client.users.fetch(ticket.openerId).catch(() => null);
    if (opener) {
      await opener.send({
        embeds: [closeEmbed(ctx, ticket, closeInfo, transcriptUrl)],
        files: [new AttachmentBuilder(transcript.filePath, { name: transcript.fileName })],
      }).catch(() => null);
    }

    ticket.status = 'closed';
    ticket.closedAt = closeInfo.closedAt;
    ticket.closedById = closeInfo.closedById;
    ticket.closeReason = reason;
    ticket.closeResult = closeInfo.resultLabel;
    ticket.transcriptPath = transcript.filePath;
    ticket.transcriptUrl = transcriptUrl;
    addOrUpdateTicket(ctx, ticket);

    await interaction.editReply({ embeds: [closeEmbed(ctx, ticket, closeInfo, transcriptUrl)] });
    await deleteTicketChannel(interaction.channel);
    return true;
  },
};
