import 'dotenv/config';
import { PermissionsBitField, REST, Routes } from 'discord.js';
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

const permissions = new PermissionsBitField([
  'ViewChannel',
  'SendMessages',
  'ReadMessageHistory',
  'ManageChannels',
  'ManageRoles',
  'ManageMessages',
  'AttachFiles',
  'AddReactions',
]).bitfield.toString();
const inviteParams = new URLSearchParams({
  client_id: clientId,
  permissions,
  scope: 'bot applications.commands',
});
const commandNames = deployedCommands.map((command) => `/${command.name}`).join(', ');
console.log(`Deployed ${deployedCommands.length} guild slash commands to ${guildId}: ${commandNames}`);
console.log(`If commands are not visible, re-invite the bot with this URL: https://discord.com/oauth2/authorize?${inviteParams.toString()}`);
