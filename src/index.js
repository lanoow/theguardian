import 'dotenv/config';
import {
  ActivityType,
  Client,
  GatewayIntentBits,
  MessageFlags,
  Partials,
} from 'discord.js';
import { buildHelpEmbed } from './commands/help.js';
import { createContext } from './core/context.js';
import { logger } from './core/logger.js';
import { embedsModule } from './modules/embeds.js';
import { pollsModule } from './modules/polls.js';
import { statsModule } from './modules/stats.js';
import { ticketsModule } from './modules/tickets.js';
import { verificationModule } from './modules/verification.js';
import { validateConfig } from './services/config-validator.js';

const token = process.env.DISCORD_TOKEN;
if (!token) throw new Error('DISCORD_TOKEN is required.');

function explainStartupError(error) {
  if (error?.message !== 'Used disallowed intents') return false;

  logger.error('Discord rejected one or more privileged gateway intents.');
  logger.error('Enable Server Members Intent and Message Content Intent in the Discord Developer Portal under Bot > Privileged Gateway Intents.');
  logger.error('Server Members Intent is required for verification and role statistics. Message Content Intent is required for setup wizards and ticket questions.');
  return true;
}

const ctx = createContext();
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.User],
});

client.once('clientReady', async () => {
  logger.info(`Logged in as ${client.user.tag}`);
  const activity = ctx.config.bot?.activity;
  if (activity) {
    client.user.setActivity(activity, { type: ActivityType.Watching });
  }

  await Promise.allSettled([
    validateConfig(client, ctx),
    verificationModule.ready(client, ctx),
    pollsModule.ready(client, ctx),
    statsModule.ready(client, ctx),
    ticketsModule.ready(client, ctx),
  ]);
});

client.on('guildMemberAdd', async (member) => {
  await verificationModule.onGuildMemberAdd(member, ctx).catch((error) => {
    logger.warn('Failed to process guildMemberAdd:', error);
  });
  statsModule.recordMemberAdd(member, ctx);
});

client.on('guildMemberRemove', async (member) => {
  statsModule.recordMemberRemove(member, ctx);
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
  statsModule.recordMemberUpdate(oldMember, newMember, ctx);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !client.user) return;
  await ticketsModule.handleMessage(message, ctx).catch((error) => {
    logger.warn('Failed to process ticket message activity:', error);
  });

  if (!message.mentions.users.has(client.user.id)) return;

  await message.reply({
    embeds: [buildHelpEmbed(ctx.config)],
    allowedMentions: { repliedUser: false },
  }).catch((error) => {
    logger.warn('Failed to send mention help:', error);
  });
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isButton()) {
      if (await verificationModule.handleButton(interaction, ctx)) {
        statsModule.scheduleRefresh(interaction.guild, ctx);
        return;
      }
      if (await ticketsModule.handleButton(interaction, ctx)) return;
      if (await ticketsModule.handleRatingButton(interaction, ctx)) return;
    }

    if (interaction.isStringSelectMenu()) {
      if (await ticketsModule.handleSelect(interaction, ctx)) return;
    }

    if (interaction.isModalSubmit()) {
      if (await embedsModule.handleModal(interaction, ctx)) return;
      if (await pollsModule.handleModal(interaction, ctx)) return;
    }

    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'setup') {
      const subcommand = interaction.options.getSubcommand();
      if (subcommand === 'verification-panel') {
        await verificationModule.postPanel(interaction, ctx);
        return;
      }
      if (subcommand === 'ticket-panel') {
        await ticketsModule.postPanel(interaction, ctx);
        return;
      }
      if (subcommand === 'refresh-panel') {
        const panel = interaction.options.getString('panel', true);
        if (panel === 'verification') {
          await verificationModule.refreshPanel(interaction, ctx);
          return;
        }
        if (await ticketsModule.refreshPanel(interaction, ctx)) return;
      }
    }

    if (interaction.commandName === 'ticket') {
      if (await ticketsModule.handleCommand(interaction, ctx)) return;
    }

    if (interaction.commandName === 'embed') {
      if (await embedsModule.handleCommand(interaction, ctx)) return;
    }

    if (interaction.commandName === 'poll') {
      if (await pollsModule.handleCommand(interaction, ctx)) return;
    }

    if (interaction.commandName === 'stats') {
      if (await statsModule.handleCommand(interaction, ctx)) return;
    }
  } catch (error) {
    logger.error('Interaction failed:', error);
    const payload = { content: 'Something went wrong while running that command.', flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(payload).catch(() => null);
    } else {
      await interaction.reply(payload).catch(() => null);
    }
  }
});

client.on('shardError', (error) => {
  if (!explainStartupError(error)) {
    logger.error('Discord shard error:', error);
  }
});

process.on('unhandledRejection', (error) => {
  if (!explainStartupError(error)) {
    logger.error('Unhandled rejection:', error);
  }
});

client.login(token).catch((error) => {
  if (!explainStartupError(error)) {
    logger.error('Failed to log in:', error);
  }
  process.exitCode = 1;
});
