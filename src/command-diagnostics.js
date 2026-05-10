import 'dotenv/config';
import { PermissionsBitField, REST, Routes } from 'discord.js';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !clientId || !guildId) {
  throw new Error('DISCORD_TOKEN, DISCORD_CLIENT_ID, and DISCORD_GUILD_ID are required.');
}

const requiredPermissions = new PermissionsBitField([
  'ViewChannel',
  'SendMessages',
  'ReadMessageHistory',
  'ManageChannels',
  'ManageRoles',
  'ManageMessages',
  'AttachFiles',
  'AddReactions',
]).bitfield.toString();

export function inviteUrl() {
  const params = new URLSearchParams({
    client_id: clientId,
    permissions: requiredPermissions,
    scope: 'bot applications.commands',
  });

  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

const rest = new REST({ version: '10' }).setToken(token);
const commands = await rest.get(Routes.applicationGuildCommands(clientId, guildId));

console.log(`Guild command target: ${guildId}`);
console.log(`Application client ID: ${clientId}`);
console.log(`Registered guild commands: ${commands.length}`);

if (commands.length) {
  console.log(commands.map((command) => `/${command.name}`).join(', '));
} else {
  console.log('No guild commands are currently registered for this application in this guild.');
}

console.log(`Invite URL with required scopes: ${inviteUrl()}`);
