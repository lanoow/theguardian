export class WizardTimeoutError extends Error {
  constructor() {
    super('Wizard timed out.');
  }
}

export async function askText(channel, user, question, options = {}) {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const prompt = await channel.send(`${user}, ${question}`);

  try {
    const collected = await channel.awaitMessages({
      filter: (message) => message.author.id === user.id,
      max: 1,
      time: timeoutMs,
      errors: ['time'],
    });
    const answer = collected.first();
    return { prompt, answer, content: answer.content, attachments: [...answer.attachments.values()] };
  } catch {
    throw new WizardTimeoutError();
  }
}

export async function runTextWizard(channel, user, questions, options = {}) {
  const answers = [];
  const cleanup = [];

  for (const question of questions) {
    const result = await askText(channel, user, question, options);
    answers.push({
      question,
      answer: result.content || result.attachments.map((a) => a.url).join('\n') || '(no text)',
      attachments: result.attachments.map((attachment) => ({
        name: attachment.name,
        url: attachment.url,
        contentType: attachment.contentType,
      })),
    });
    cleanup.push(result.prompt, result.answer);
  }

  if (options.deleteMessages) {
    await Promise.allSettled(cleanup.map((message) => message.delete()));
  }

  return answers;
}
