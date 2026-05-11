import {
  ActionRowBuilder,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { requireStaff } from '../utils/permissions.js';

function getConfig(ctx) {
  return ctx.config.modules.embeds ?? {};
}

function clean(value) {
  const text = String(value ?? '').trim();
  if (!text || ['skip', 'none', 'no', '-'].includes(text.toLowerCase())) return null;
  return text;
}

function color(value, fallback) {
  const text = clean(value);
  if (!text) return fallback;
  return /^#?[0-9a-f]{6}$/i.test(text) ? (text.startsWith('#') ? text : `#${text}`) : fallback;
}

function buildEmbedFromData(data, current = null) {
  const embed = new EmbedBuilder();

  const title = clean(data.title) ?? current?.title;
  const description = clean(data.description) ?? current?.description;
  const embedColor = color(data.color, current?.hexColor ?? '#5865F2');
  const image = clean(data.image) ?? current?.image?.url;
  const thumbnail = clean(data.thumbnail) ?? current?.thumbnail?.url;
  const footer = current?.footer?.text;

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

function textInput(id, label, style, required = false, value = '') {
  const input = new TextInputBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setStyle(style)
    .setRequired(required);

  if (value) input.setValue(value.slice(0, style === TextInputStyle.Paragraph ? 4000 : 1000));
  return new ActionRowBuilder().addComponents(input);
}

async function showEmbedModal(interaction, action, channel, message = null) {
  const current = message?.embeds[0] ?? null;
  const modal = new ModalBuilder()
    .setCustomId(`embed:${action}:${channel.id}${message ? `:${message.id}` : ''}`)
    .setTitle(action === 'edit' ? 'Edit embed' : 'Create embed')
    .addComponents(
      textInput('title', 'Title (optional)', TextInputStyle.Short, false, current?.title ?? ''),
      textInput('description', 'Content (optional)', TextInputStyle.Paragraph, false, current?.description ?? ''),
      textInput('color', 'Hex color (optional)', TextInputStyle.Short, false, current?.hexColor ?? '#5865F2'),
      textInput('image', 'Image URL (optional)', TextInputStyle.Short, false, current?.image?.url ?? ''),
      textInput('thumbnail', 'Thumbnail URL (optional)', TextInputStyle.Short, false, current?.thumbnail?.url ?? '')
    );

  await interaction.showModal(modal);
}

export const embedsModule = {
  async handleCommand(interaction, ctx) {
    const config = getConfig(ctx);
    if (!config.enabled) {
      await interaction.reply({ content: 'Embed tools are disabled.', flags: MessageFlags.Ephemeral });
      return true;
    }
    if (!await requireStaff(interaction, ctx.config, config.staffRoles ?? [])) return true;

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'delete') {
      const channel = await targetChannel(interaction);
      const messageId = interaction.options.getString('message_id', true);
      const message = await channel.messages.fetch(messageId).catch(() => null);
      if (!message) {
        await interaction.reply({ content: 'Message not found.', flags: MessageFlags.Ephemeral });
        return true;
      }
      if (message.author.id !== interaction.client.user.id) {
        await interaction.reply({ content: 'I can only delete embed messages that were sent by this bot.', flags: MessageFlags.Ephemeral });
        return true;
      }
      await message.delete();
      await interaction.reply({ content: 'Embed deleted.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const channel = await targetChannel(interaction);

    if (subcommand === 'create') {
      await showEmbedModal(interaction, 'create', channel);
      return true;
    }

    if (subcommand === 'edit') {
      const messageId = interaction.options.getString('message_id', true);
      const message = await channel.messages.fetch(messageId).catch(() => null);
      if (!message) {
        await interaction.reply({ content: 'Message not found.', flags: MessageFlags.Ephemeral });
        return true;
      }
      if (message.author.id !== interaction.client.user.id) {
        await interaction.reply({ content: 'I can only edit embed messages that were sent by this bot.', flags: MessageFlags.Ephemeral });
        return true;
      }

      await showEmbedModal(interaction, 'edit', channel, message);
      return true;
    }

    return false;
  },

  async handleModal(interaction, ctx) {
    if (!interaction.customId.startsWith('embed:')) return false;
    const [, action, channelId, messageId] = interaction.customId.split(':');
    const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) {
      await interaction.reply({ content: 'Embed target channel no longer exists.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const data = {
      title: interaction.fields.getTextInputValue('title'),
      description: interaction.fields.getTextInputValue('description'),
      color: interaction.fields.getTextInputValue('color'),
      image: interaction.fields.getTextInputValue('image'),
      thumbnail: interaction.fields.getTextInputValue('thumbnail'),
    };

    if (action === 'create') {
      await channel.send({ embeds: [buildEmbedFromData(data)] });
      await interaction.reply({ content: `Embed posted in ${channel}.`, flags: MessageFlags.Ephemeral });
      return true;
    }

    if (action === 'edit') {
      const message = await channel.messages.fetch(messageId).catch(() => null);
      if (!message || message.author.id !== interaction.client.user.id) {
        await interaction.reply({ content: 'Embed message not found or is not owned by this bot.', flags: MessageFlags.Ephemeral });
        return true;
      }

      await message.edit({ embeds: [buildEmbedFromData(data, message.embeds[0] ?? null)] });
      await interaction.reply({ content: 'Embed updated.', flags: MessageFlags.Ephemeral });
      return true;
    }

    return false;
  },
};
