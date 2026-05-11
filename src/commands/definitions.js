import {
  ChannelType,
  SlashCommandBuilder,
} from 'discord.js';

export function buildCommandData() {
  return [
    new SlashCommandBuilder()
      .setName('setup')
      .setDescription('Post configured bot panels.')
      .addSubcommand((subcommand) =>
        subcommand
          .setName('verification-panel')
          .setDescription('Post the verification panel.')
          .addChannelOption((option) =>
            option
              .setName('channel')
              .setDescription('Where to post the panel.')
              .addChannelTypes(ChannelType.GuildText)
          )
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('ticket-panel')
          .setDescription('Post a support or bug ticket panel.')
          .addStringOption((option) =>
            option
              .setName('kind')
              .setDescription('Which panel to post.')
              .setRequired(true)
              .addChoices(
                { name: 'Support', value: 'support' },
                { name: 'Bug tracker', value: 'bugs' }
              )
          )
          .addChannelOption((option) =>
            option
              .setName('channel')
              .setDescription('Where to post the panel.')
              .addChannelTypes(ChannelType.GuildText)
          )
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('refresh-panel')
          .setDescription('Refresh a stored bot panel if it exists.')
          .addStringOption((option) =>
            option
              .setName('panel')
              .setDescription('Panel to refresh.')
              .setRequired(true)
              .addChoices(
                { name: 'Verification', value: 'verification' },
                { name: 'Support tickets', value: 'support' },
                { name: 'Bug reports', value: 'bugs' }
              )
          )
      ),

    new SlashCommandBuilder()
      .setName('ticket')
      .setDescription('Manage tickets.')
      .addSubcommand((subcommand) =>
        subcommand
          .setName('close')
          .setDescription('Close the current ticket.')
          .addStringOption((option) =>
            option
              .setName('result')
              .setDescription('Ticket result.')
              .setRequired(true)
              .addChoices(
                { name: 'Resolved', value: 'resolved' },
                { name: 'Unresolved', value: 'unresolved' },
                { name: 'Other', value: 'other' }
              )
          )
          .addStringOption((option) =>
            option
              .setName('reason')
              .setDescription('Why the ticket is being closed.')
              .setRequired(true)
              .setMaxLength(500)
          )
          .addStringOption((option) =>
            option
              .setName('other_result')
              .setDescription('Required when result is Other.')
              .setMaxLength(200)
          )
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('claim')
          .setDescription('Claim the current ticket.')
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('priority')
          .setDescription('Change the current ticket priority.')
          .addStringOption((option) =>
            option
              .setName('level')
              .setDescription('Priority level.')
              .setRequired(true)
              .addChoices(
                { name: 'Low', value: 'low' },
                { name: 'Normal', value: 'normal' },
                { name: 'High', value: 'high' },
                { name: 'Urgent', value: 'urgent' }
              )
          )
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('reopen')
          .setDescription('Reopen a closed ticket into a new channel.')
          .addStringOption((option) =>
            option
              .setName('ticket_id')
              .setDescription('Ticket ID from the transcript/close embed.')
              .setRequired(true)
          )
      )
      .addSubcommandGroup((group) =>
        group
          .setName('blacklist')
          .setDescription('Manage ticket blacklist.')
          .addSubcommand((subcommand) =>
            subcommand
              .setName('add')
              .setDescription('Block a user from opening tickets.')
              .addUserOption((option) =>
                option.setName('user').setDescription('User to block.').setRequired(true)
              )
          )
          .addSubcommand((subcommand) =>
            subcommand
              .setName('remove')
              .setDescription('Allow a user to open tickets again.')
              .addUserOption((option) =>
                option.setName('user').setDescription('User to unblock.').setRequired(true)
              )
          )
      ),

    new SlashCommandBuilder()
      .setName('embed')
      .setDescription('Create, edit, or delete embeds.')
      .addSubcommand((subcommand) =>
        subcommand
          .setName('create')
          .setDescription('Create an embed using guided steps.')
          .addChannelOption((option) =>
            option
              .setName('channel')
              .setDescription('Where to post the embed.')
              .addChannelTypes(ChannelType.GuildText)
          )
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('edit')
          .setDescription('Edit an existing bot embed using guided steps.')
          .addStringOption((option) =>
            option.setName('message_id').setDescription('Message ID to edit.').setRequired(true)
          )
          .addChannelOption((option) =>
            option
              .setName('channel')
              .setDescription('Channel containing the message.')
              .addChannelTypes(ChannelType.GuildText)
          )
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('delete')
          .setDescription('Delete an existing bot embed.')
          .addStringOption((option) =>
            option.setName('message_id').setDescription('Message ID to delete.').setRequired(true)
          )
          .addChannelOption((option) =>
            option
              .setName('channel')
              .setDescription('Channel containing the message.')
              .addChannelTypes(ChannelType.GuildText)
          )
      ),

    new SlashCommandBuilder()
      .setName('poll')
      .setDescription('Create a timed poll.')
      .addSubcommand((subcommand) =>
        subcommand
          .setName('create')
          .setDescription('Create a poll using guided steps.')
      ),

    new SlashCommandBuilder()
      .setName('stats')
      .setDescription('Manage stat voice channels.')
      .addSubcommand((subcommand) =>
        subcommand.setName('refresh').setDescription('Refresh configured stat channels now.')
      ),
  ].map((command) => command.toJSON());
}
