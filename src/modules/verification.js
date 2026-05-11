import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from 'discord.js';
import { baseEmbed } from '../utils/embed.js';
import { ids } from '../utils/ids.js';
import { requireStaff } from '../utils/permissions.js';

function getConfig(ctx) {
  return ctx.config.modules.verification ?? {};
}

function buildPanel(ctx) {
  const config = getConfig(ctx);
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
    .setCustomId(ids.verificationButton)
    .setLabel(panel.buttonLabel ?? 'Verify')
    .setStyle(ButtonStyle.Success);

  if (panel.buttonEmoji) button.setEmoji(panel.buttonEmoji);

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(button)],
  };
}

async function savePanelMessage(ctx, key, message) {
  ctx.stores.panels.update((data) => {
    data.panels[key] = { channelId: message.channelId, messageId: message.id };
  });
}

function messageHasVerificationButton(message) {
  return message.components.some((row) =>
    row.components.some((component) => component.customId === ids.verificationButton)
  );
}

export const verificationModule = {
  async ready(client, ctx) {
    const config = getConfig(ctx);
    if (!config.enabled || config.panel?.autoPost === false || !config.verificationChannelId) return;

    const channel = await client.channels.fetch(config.verificationChannelId).catch(() => null);
    if (!channel?.isTextBased()) return;

    const recentMessages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    const existingPanel = recentMessages?.some((message) =>
      message.author.id === client.user.id && messageHasVerificationButton(message)
    );

    if (!existingPanel) {
      const message = await channel.send(buildPanel(ctx));
      await savePanelMessage(ctx, 'verification', message);
    }
  },

  async onGuildMemberAdd(member, ctx) {
    const config = getConfig(ctx);
    if (!config.enabled || !config.joinRoleId) return;
    if (config.joinRoleId === member.guild.roles.everyone.id) return;
    await member.roles.add(config.joinRoleId).catch(() => null);
  },

  async postPanel(interaction, ctx) {
    const config = getConfig(ctx);
    if (!await requireStaff(interaction, ctx.config)) return;
    if (!config.enabled) {
      await interaction.reply({ content: 'Verification is disabled.', flags: MessageFlags.Ephemeral });
      return;
    }

    const channel = interaction.options.getChannel('channel') ??
      await interaction.guild.channels.fetch(config.verificationChannelId).catch(() => null);

    if (!channel?.isTextBased()) {
      await interaction.reply({ content: 'Verification channel is not configured or cannot be found.', flags: MessageFlags.Ephemeral });
      return;
    }

    const message = await channel.send(buildPanel(ctx));
    await savePanelMessage(ctx, 'verification', message);
    await interaction.reply({ content: `Verification panel posted in ${channel}.`, flags: MessageFlags.Ephemeral });
  },

  async refreshPanel(interaction, ctx) {
    if (!await requireStaff(interaction, ctx.config)) return;
    const panel = ctx.stores.panels.read().panels.verification;
    if (!panel) {
      await interaction.reply({ content: 'No stored verification panel found. Use `/setup verification-panel` first.', flags: MessageFlags.Ephemeral });
      return;
    }

    const channel = await interaction.guild.channels.fetch(panel.channelId).catch(() => null);
    const message = channel?.isTextBased() ? await channel.messages.fetch(panel.messageId).catch(() => null) : null;
    if (!message) {
      await interaction.reply({ content: 'Stored verification panel message no longer exists. Use `/setup verification-panel` first.', flags: MessageFlags.Ephemeral });
      return;
    }

    await message.edit(buildPanel(ctx));
    await interaction.reply({ content: 'Verification panel refreshed.', flags: MessageFlags.Ephemeral });
  },

  async handleButton(interaction, ctx) {
    const config = getConfig(ctx);
    if (!config.enabled || interaction.customId !== ids.verificationButton) return false;

    const member = interaction.member;
    if (config.verifiedRoleId && member.roles.cache.has(config.verifiedRoleId)) {
      await interaction.reply({ content: config.messages?.alreadyVerified ?? 'You are already verified.', flags: MessageFlags.Ephemeral });
      return true;
    }

    try {
      if (config.verifiedRoleId) await member.roles.add(config.verifiedRoleId);
      if (config.joinRoleId && config.joinRoleId !== interaction.guild.roles.everyone.id) {
        await member.roles.remove(config.joinRoleId).catch(() => null);
      }
      await interaction.reply({ content: config.messages?.success ?? 'You are now verified.', flags: MessageFlags.Ephemeral });
    } catch {
      await interaction.reply({ content: config.messages?.failed ?? 'I could not verify you. Please contact staff.', flags: MessageFlags.Ephemeral });
    }

    return true;
  },
};
