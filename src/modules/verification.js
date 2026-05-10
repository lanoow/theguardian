import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
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

export const verificationModule = {
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
      await interaction.reply({ content: 'Verification is disabled.', ephemeral: true });
      return;
    }

    const channel = interaction.options.getChannel('channel') ??
      await interaction.guild.channels.fetch(config.verificationChannelId).catch(() => null);

    if (!channel?.isTextBased()) {
      await interaction.reply({ content: 'Verification channel is not configured or cannot be found.', ephemeral: true });
      return;
    }

    await channel.send(buildPanel(ctx));
    await interaction.reply({ content: `Verification panel posted in ${channel}.`, ephemeral: true });
  },

  async handleButton(interaction, ctx) {
    const config = getConfig(ctx);
    if (!config.enabled || interaction.customId !== ids.verificationButton) return false;

    const member = interaction.member;
    if (config.verifiedRoleId && member.roles.cache.has(config.verifiedRoleId)) {
      await interaction.reply({ content: config.messages?.alreadyVerified ?? 'You are already verified.', ephemeral: true });
      return true;
    }

    try {
      if (config.verifiedRoleId) await member.roles.add(config.verifiedRoleId);
      if (config.joinRoleId && config.joinRoleId !== interaction.guild.roles.everyone.id) {
        await member.roles.remove(config.joinRoleId).catch(() => null);
      }
      await interaction.reply({ content: config.messages?.success ?? 'You are now verified.', ephemeral: true });
    } catch {
      await interaction.reply({ content: config.messages?.failed ?? 'I could not verify you. Please contact staff.', ephemeral: true });
    }

    return true;
  },
};
