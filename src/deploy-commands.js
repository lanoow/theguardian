import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { buildCommandData } from './commands/definitions.js';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !clientId || !guildId) {
  throw new Error('DISCORD_TOKEN, DISCORD_CLIENT_ID, and DISCORD_GUILD_ID are required.');
}

const rest = new REST({ version: '10' }).setToken(token);
const commands = buildCommandData();
const deployedCommands = await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
  body: commands,
});

const commandNames = deployedCommands.map((command) => `/${command.name}`).join(', ');
console.log(`Deployed ${deployedCommands.length} guild slash commands to ${guildId}: ${commandNames}`);
