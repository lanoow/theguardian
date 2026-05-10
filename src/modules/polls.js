import { EmbedBuilder, MessageFlags } from 'discord.js';
import { runTextWizard } from '../services/wizard.js';
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

    await interaction.reply({
      content: 'Answer the poll setup questions in this channel. Use `skip` for the image.',
      flags: MessageFlags.Ephemeral,
    });

    const answers = await runTextWizard(interaction.channel, interaction.user, [
      'Which channel should receive the poll? Mention it, paste the ID, or reply `here`.',
      'What is the poll question?',
      'Poll content/body text.',
      'Image URL, or `skip`.',
      'Poll options, one per line as `emoji = meaning`.',
      'When should the poll end? Use examples like `30m`, `2h`, or `1d`.',
    ], {
      timeoutMs: 240_000,
      deleteMessages: false,
    });

    const target = answers[0].answer.toLowerCase() === 'here'
      ? interaction.channel
      : parseChannel(interaction.guild, answers[0].answer, interaction.channel);
    const duration = parseDuration(answers[5].answer);
    const options = parseOptions(answers[4].answer, config.maxOptions ?? 10);

    if (!target?.isTextBased() || !duration || options.length < 2) {
      await interaction.followUp({
        content: 'Poll creation failed. Check the target channel, duration, and provide at least two options.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const poll = {
      guildId: interaction.guildId,
      channelId: target.id,
      createdById: interaction.user.id,
      question: truncate(answers[1].answer, 256),
      content: answers[2].answer.toLowerCase() === 'skip' ? '' : truncate(answers[2].answer, 4096),
      image: answers[3].answer.toLowerCase() === 'skip' ? null : answers[3].answer,
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
    await interaction.followUp({ content: `Poll posted in ${target}.`, flags: MessageFlags.Ephemeral });
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
