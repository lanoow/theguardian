import { EmbedBuilder } from 'discord.js';
import { buildCommandData } from './definitions.js';

function commandUsage(command, subcommand = null) {
  return subcommand ? `/${command.name} ${subcommand.name}` : `/${command.name}`;
}

function commandLines() {
  return buildCommandData().flatMap((command) => {
    const subcommands = (command.options ?? []).filter((option) => option.type === 1);

    if (subcommands.length === 0) {
      return [`**${commandUsage(command)}** - ${command.description}`];
    }

    return subcommands.map((subcommand) =>
      `**${commandUsage(command, subcommand)}** - ${subcommand.description}`
    );
  });
}

export function buildHelpEmbed(config) {
  const lines = commandLines();
  const embed = new EmbedBuilder()
    .setTitle('Available commands')
    .setDescription(lines.join('\n'))
    .setColor(config.bot?.defaultColor ?? '#5865F2')
    .setFooter({ text: 'Use slash commands to run bot actions.' })
    .setTimestamp(new Date());

  return embed;
}
