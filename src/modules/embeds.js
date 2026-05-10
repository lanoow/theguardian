import { EmbedBuilder } from 'discord.js';
import { runTextWizard } from '../services/wizard.js';
import { requireStaff } from '../utils/permissions.js';

function getConfig(ctx) {
  return ctx.config.modules.embeds ?? {};
}

function clean(value) {
  const text = String(value ?? '').trim();
  if (!text || text.toLowerCase() === 'skip' || text.toLowerCase() === 'none') return null;
  return text;
}

function color(value, fallback) {
  const text = clean(value);
  if (!text) return fallback;
  return /^#?[0-9a-f]{6}$/i.test(text) ? (text.startsWith('#') ? text : `#${text}`) : fallback;
}

function buildEmbedFromAnswers(answers, current = null) {
  const get = (index) => clean(answers[index]?.answer);
  const embed = new EmbedBuilder();

  const title = get(0) ?? current?.title;
  const description = get(1) ?? current?.description;
  const embedColor = color(answers[2]?.answer, current?.hexColor ?? '#5865F2');
  const image = get(3) ?? current?.image?.url;
  const thumbnail = get(4) ?? current?.thumbnail?.url;
  const footer = get(5) ?? current?.footer?.text;

  if (title) embed.setTitle(title);
  if (description) embed.setDescription(description);
  if (embedColor) embed.setColor(embedColor);
  if (image) embed.setImage(image);
  if (thumbnail) embed.setThumbnail(thumbnail);
  if (footer) embed.setFooter({ text: footer });
  embed.setTimestamp(new Date());

  return embed;
}

async function targetChannel(interaction) {
  return interaction.options.getChannel('channel') ?? interaction.channel;
}

async function collectEmbed(interaction, current = null) {
  const questions = [
    `embed title${current?.title ? ` (current: ${current.title})` : ''}. Reply "skip" to leave blank/current.`,
    `embed content/description${current?.description ? ' (reply "skip" to keep current)' : ''}.`,
    `hex color${current?.hexColor ? ` (current: ${current.hexColor})` : ''}. Example: #5865F2.`,
    `image URL${current?.image?.url ? ' (reply "skip" to keep current)' : ''}.`,
    `thumbnail/cover URL${current?.thumbnail?.url ? ' (reply "skip" to keep current)' : ''}.`,
    `footer text${current?.footer?.text ? ' (reply "skip" to keep current)' : ''}.`,
  ];

  return runTextWizard(interaction.channel, interaction.user, questions, {
    timeoutMs: 180_000,
    deleteMessages: false,
  });
}

export const embedsModule = {
  async handleCommand(interaction, ctx) {
    const config = getConfig(ctx);
    if (!config.enabled) {
      await interaction.reply({ content: 'Embed tools are disabled.', ephemeral: true });
      return true;
    }
    if (!await requireStaff(interaction, ctx.config, config.staffRoles ?? [])) return true;

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'delete') {
      const channel = await targetChannel(interaction);
      const messageId = interaction.options.getString('message_id', true);
      const message = await channel.messages.fetch(messageId).catch(() => null);
      if (!message) {
        await interaction.reply({ content: 'Message not found.', ephemeral: true });
        return true;
      }
      if (message.author.id !== interaction.client.user.id) {
        await interaction.reply({ content: 'I can only delete embed messages that were sent by this bot.', ephemeral: true });
        return true;
      }
      await message.delete();
      await interaction.reply({ content: 'Embed deleted.', ephemeral: true });
      return true;
    }

    await interaction.reply({
      content: 'Answer the embed setup questions in this channel. Reply `skip` for optional fields.',
      ephemeral: true,
    });

    const channel = await targetChannel(interaction);

    if (subcommand === 'create') {
      const answers = await collectEmbed(interaction);
      const embed = buildEmbedFromAnswers(answers);
      await channel.send({ embeds: [embed] });
      await interaction.followUp({ content: `Embed posted in ${channel}.`, ephemeral: true });
      return true;
    }

    if (subcommand === 'edit') {
      const messageId = interaction.options.getString('message_id', true);
      const message = await channel.messages.fetch(messageId).catch(() => null);
      if (!message) {
        await interaction.followUp({ content: 'Message not found.', ephemeral: true });
        return true;
      }
      if (message.author.id !== interaction.client.user.id) {
        await interaction.followUp({ content: 'I can only edit embed messages that were sent by this bot.', ephemeral: true });
        return true;
      }

      const current = message.embeds[0] ?? null;
      const answers = await collectEmbed(interaction, current);
      const embed = buildEmbedFromAnswers(answers, current);
      await message.edit({ embeds: [embed] });
      await interaction.followUp({ content: 'Embed updated.', ephemeral: true });
      return true;
    }

    return false;
  },
};
