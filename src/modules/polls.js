import {
  ActionRowBuilder,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { parseDuration } from '../utils/duration.js';
import { requireStaff } from '../utils/permissions.js';
import { truncate } from '../utils/text.js';

function getConfig(ctx) {
  return ctx.config.modules.polls ?? {};
}

function parseChannel(guild, value, fallback) {
  const id = String(value ?? '').match(/\d{17,20}/)?.[0];
  return id ? guild.channels.cache.get(id) : fallback;
}

function parseOptions(value, maxOptions) {
  return String(value ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxOptions)
    .map((line) => {
      const [emoji, ...rest] = line.split(/\s*=\s*/);
      return {
        emoji: emoji.trim(),
        label: (rest.join(' = ') || emoji).trim(),
      };
    })
    .filter((option) => option.emoji && option.label);
}

function isSkip(value) {
  return ['skip', 'none', 'no', '-'].includes(String(value ?? '').trim().toLowerCase());
}

function pollEmbed(ctx, poll, status = 'open') {
  const embed = new EmbedBuilder()
    .setTitle(status === 'open' ? poll.question : `${poll.question} (ended)`)
    .setColor(status === 'open' ? (getConfig(ctx).defaultColor ?? '#FEE75C') : '#99AAB5')
    .setTimestamp(new Date(status === 'open' ? poll.endsAt : Date.now()))
    .addFields(
      poll.options.map((option) => ({
        name: `${option.emoji} ${option.label}`,
        value: status === 'open'
          ? 'Voting open'
          : `${option.votes ?? 0} vote${(option.votes ?? 0) === 1 ? '' : 's'}`,
        inline: false,
      }))
    );

  if (poll.image) embed.setImage(poll.image);
  if (poll.content) embed.setDescription(poll.content);
  embed.setFooter({ text: status === 'open' ? 'Poll ends' : 'Poll ended' });
  return embed;
}

function savePoll(ctx, poll) {
  ctx.stores.polls.update((data) => {
    const index = data.polls.findIndex((item) => item.messageId === poll.messageId);
    if (index === -1) data.polls.push(poll);
    else data.polls[index] = poll;
  });
}

async function createPollFromData(interaction, ctx, data) {
  const config = getConfig(ctx);
  const target = data.channel.toLowerCase() === 'here'
    ? interaction.channel
    : parseChannel(interaction.guild, data.channel, interaction.channel);
  const duration = parseDuration(data.duration);
  const options = parseOptions(data.options, config.maxOptions ?? 10);

  if (!target?.isTextBased() || !duration || options.length < 2) {
    await interaction.reply({
      content: 'Poll creation failed. Check the target channel, duration, and provide at least two options.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const poll = {
    guildId: interaction.guildId,
    channelId: target.id,
    createdById: interaction.user.id,
    question: truncate(data.question, 256),
    content: isSkip(data.content) ? '' : truncate(data.content, 4096),
    image: isSkip(data.image) ? null : data.image,
    options,
    endsAt: new Date(Date.now() + duration).toISOString(),
    status: 'open',
  };

  const message = await target.send({ embeds: [pollEmbed(ctx, poll)] });
  poll.messageId = message.id;

  for (const option of options) {
    await message.react(option.emoji).catch(() => null);
  }

  savePoll(ctx, poll);
  await interaction.reply({ content: `Poll posted in ${target}.`, flags: MessageFlags.Ephemeral });
}

function modalInput(id, label, style, required = true, placeholder = '') {
  const input = new TextInputBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setStyle(style)
    .setRequired(required);

  if (placeholder) input.setPlaceholder(placeholder);
  return new ActionRowBuilder().addComponents(input);
}

async function endPoll(client, ctx, poll) {
  const channel = await client.channels.fetch(poll.channelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  const message = await channel.messages.fetch(poll.messageId).catch(() => null);
  if (!message) return;

  const options = [];
  for (const option of poll.options) {
    const cachedReaction = message.reactions.cache.get(option.emoji);
    const resolvedReaction = message.reactions.resolve(option.emoji);
    const reaction = cachedReaction ?? (resolvedReaction ? await resolvedReaction.fetch().catch(() => null) : null);
    options.push({
      ...option,
      votes: Math.max(0, (reaction?.count ?? 1) - 1),
    });
  }

  const ended = {
    ...poll,
    options,
    status: 'ended',
    endedAt: new Date().toISOString(),
  };

  await message.edit({ embeds: [pollEmbed(ctx, ended, 'ended')] }).catch(() => null);
  savePoll(ctx, ended);
}

export const pollsModule = {
  async handleCommand(interaction, ctx) {
    const config = getConfig(ctx);
    if (!config.enabled) {
      await interaction.reply({ content: 'Polls are disabled.', flags: MessageFlags.Ephemeral });
      return true;
    }
    if (!await requireStaff(interaction, ctx.config, config.staffRoles ?? [])) return true;

    const modal = new ModalBuilder()
      .setCustomId('poll:create')
      .setTitle('Create poll')
      .addComponents(
        modalInput('channel', 'Channel ID/mention or here', TextInputStyle.Short, true, 'here'),
        modalInput('question', 'Poll question', TextInputStyle.Short),
        modalInput('content', 'Poll content or skip', TextInputStyle.Paragraph, false, 'skip'),
        modalInput('options', 'Options: emoji = meaning, one per line', TextInputStyle.Paragraph),
        modalInput('duration', 'Duration: 30m, 2h, 1d', TextInputStyle.Short)
      );

    await interaction.showModal(modal);
    return true;
  },

  async handleModal(interaction, ctx) {
    if (interaction.customId !== 'poll:create') return false;
    await createPollFromData(interaction, ctx, {
      channel: interaction.fields.getTextInputValue('channel'),
      question: interaction.fields.getTextInputValue('question'),
      content: interaction.fields.getTextInputValue('content'),
      image: '',
      options: interaction.fields.getTextInputValue('options'),
      duration: interaction.fields.getTextInputValue('duration'),
    });
    return true;
  },

  async ready(client, ctx) {
    const check = async () => {
      const data = ctx.stores.polls.read();
      const openPolls = data.polls.filter((poll) => poll.status === 'open' && new Date(poll.endsAt).getTime() <= Date.now());
      for (const poll of openPolls) {
        await endPoll(client, ctx, poll).catch(() => null);
      }
    };

    await check();
    setInterval(check, 60_000);
  },
};
