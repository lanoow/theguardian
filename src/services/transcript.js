import fs from 'node:fs';
import path from 'node:path';
import { escapeHtml } from '../utils/text.js';

async function fetchMessages(channel, limit) {
  const messages = [];
  let before;

  while (messages.length < limit) {
    const batch = await channel.messages.fetch({ limit: Math.min(100, limit - messages.length), before });
    if (batch.size === 0) break;
    messages.push(...batch.values());
    before = batch.last().id;
  }

  return messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

function renderAttachment(attachment) {
  const url = escapeHtml(attachment.url);
  const name = escapeHtml(attachment.name ?? 'attachment');

  if (attachment.contentType?.startsWith('image/')) {
    return `<a class="attachment" href="${url}"><img src="${url}" alt="${name}"></a>`;
  }

  return `<a class="file" href="${url}">${name}</a>`;
}

function renderMessage(message) {
  const author = message.author;
  const avatar = author.displayAvatarURL({ extension: 'png', size: 64 });
  const timestamp = new Date(message.createdTimestamp).toLocaleString();
  const content = message.content ? escapeHtml(message.content).replaceAll('\n', '<br>') : '';
  const embeds = message.embeds
    .map((embed) => {
      const title = embed.title ? `<div class="embed-title">${escapeHtml(embed.title)}</div>` : '';
      const description = embed.description ? `<div>${escapeHtml(embed.description).replaceAll('\n', '<br>')}</div>` : '';
      return `<div class="embed">${title}${description}</div>`;
    })
    .join('');
  const attachments = [...message.attachments.values()].map(renderAttachment).join('');

  return `
    <article class="message">
      <img class="avatar" src="${escapeHtml(avatar)}" alt="">
      <div class="body">
        <div class="meta">
          <span class="name">${escapeHtml(author.tag)}</span>
          <span class="time">${escapeHtml(timestamp)}</span>
        </div>
        <div class="content">${content || '<span class="muted">(no text)</span>'}</div>
        ${embeds}
        ${attachments ? `<div class="attachments">${attachments}</div>` : ''}
      </div>
    </article>
  `;
}

export async function createTranscript(channel, ticket, closeInfo, options) {
  fs.mkdirSync(options.transcriptDir, { recursive: true });
  const timestamp = Date.now();
  const fileName = `transcript-${timestamp}.html`;
  const filePath = path.join(options.transcriptDir, fileName);
  const messages = await fetchMessages(channel, options.limit ?? 1000);

  const qa = (ticket.answers ?? [])
    .map((item) => `<dt>${escapeHtml(item.question)}</dt><dd>${escapeHtml(item.answer).replaceAll('\n', '<br>')}</dd>`)
    .join('');

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(channel.name)} transcript</title>
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; background: #313338; color: #dbdee1; font: 16px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    header { padding: 28px 32px; background: #2b2d31; border-bottom: 1px solid #1e1f22; }
    h1 { margin: 0 0 8px; font-size: 24px; color: #f2f3f5; }
    .summary { color: #b5bac1; display: grid; gap: 4px; }
    main { padding: 20px 0 40px; }
    .qa { margin: 20px 32px; padding: 18px; background: #2b2d31; border-left: 4px solid #5865f2; border-radius: 6px; }
    .qa h2 { margin: 0 0 12px; font-size: 16px; color: #f2f3f5; }
    dt { margin-top: 12px; color: #f2f3f5; font-weight: 700; }
    dd { margin: 4px 0 0; color: #dbdee1; }
    .message { display: grid; grid-template-columns: 48px 1fr; gap: 14px; padding: 8px 32px; }
    .message:hover { background: #2e3035; }
    .avatar { width: 40px; height: 40px; border-radius: 50%; margin-top: 2px; }
    .meta { display: flex; align-items: baseline; gap: 8px; margin-bottom: 2px; }
    .name { color: #f2f3f5; font-weight: 700; }
    .time { color: #949ba4; font-size: 12px; }
    .content { white-space: normal; overflow-wrap: anywhere; }
    .muted { color: #949ba4; }
    .embed { margin-top: 8px; max-width: 520px; padding: 12px; border-left: 4px solid #5865f2; border-radius: 4px; background: #2b2d31; }
    .embed-title { margin-bottom: 4px; color: #f2f3f5; font-weight: 700; }
    .attachments { display: grid; gap: 8px; margin-top: 8px; }
    .attachment img { max-width: min(520px, 100%); border-radius: 6px; }
    .file { color: #00a8fc; }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(channel.name)} transcript</h1>
    <div class="summary">
      <span>Opened by: ${escapeHtml(ticket.openerTag ?? ticket.openerId)}</span>
      <span>Closed by: ${escapeHtml(closeInfo.closedByTag)}</span>
      <span>Reason: ${escapeHtml(closeInfo.reason)}</span>
      <span>Result: ${escapeHtml(closeInfo.resultLabel)}</span>
      <span>Generated: ${escapeHtml(new Date(timestamp).toLocaleString())}</span>
    </div>
  </header>
  <main>
    ${qa ? `<section class="qa"><h2>Initial Questions</h2><dl>${qa}</dl></section>` : ''}
    ${messages.map(renderMessage).join('\n')}
  </main>
</body>
</html>`;

  fs.writeFileSync(filePath, html);
  return { fileName, filePath, messageCount: messages.length };
}
