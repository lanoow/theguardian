import { EmbedBuilder } from 'discord.js';

export function baseEmbed(config, data = {}) {
  const color = data.color ?? config.bot?.defaultColor ?? '#5865F2';
  const embed = new EmbedBuilder().setColor(color);

  if (data.title) embed.setTitle(data.title);
  if (data.description) embed.setDescription(data.description);
  if (data.url) embed.setURL(data.url);
  if (data.thumbnail) embed.setThumbnail(data.thumbnail);
  if (data.image) embed.setImage(data.image);
  if (data.footer) embed.setFooter({ text: data.footer });
  if (data.author) embed.setAuthor({ name: data.author });
  if (data.timestamp) embed.setTimestamp(data.timestamp === true ? new Date() : data.timestamp);

  return embed;
}

export function buildFieldsEmbed(config, data, fields = []) {
  const embed = baseEmbed(config, data);
  if (fields.length) embed.addFields(fields);
  return embed;
}
