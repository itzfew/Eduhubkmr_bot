import { Context } from 'telegraf';
import createDebug from 'debug';
import quizData from '../../data/quiz.json'; // adjust path as needed

const debug = createDebug('bot:quizes');

const quizes = () => async (ctx: Context) => {
  debug('Triggered "quizes" handler');

  if (!ctx.message || !('text' in ctx.message)) return;

  const text = ctx.message.text.trim().toLowerCase();
  const match = text.match(/^\/(pyq(b|c|p)?|[bcp]1)(\s*\d+)?$/);

  if (!match) return;

  const cmd = match[1];
  const subjectCode = match[2];
  const count = match[3] ? parseInt(match[3].trim(), 10) : 1;

  const subjectMap: Record<string, string> = {
    b: 'biology',
    c: 'chemistry',
    p: 'physics',
  };

  let subject: string | null = null;
  let isMixed = false;

  if (cmd === 'pyq') {
    isMixed = true;
  } else if (subjectCode) {
    subject = subjectMap[subjectCode];
  } else if (['b1', 'c1', 'p1'].includes(cmd)) {
    subject = subjectMap[cmd[0]];
  }

  try {
    const allQuestions = quizData;

    let filtered = isMixed
      ? allQuestions
      : allQuestions.filter((q: any) => q.subject?.toLowerCase() === subject);

    if (!filtered.length) {
      await ctx.reply(`No questions available for ${subject || 'the selected subjects'}.`);
      return;
    }

    const shuffled = filtered.sort(() => 0.5 - Math.random());
    const selected = shuffled.slice(0, Math.min(count, filtered.length));

    for (const question of selected) {
      const options = [question.options.A, question.options.B, question.options.C, question.options.D];
      const correctOptionIndex = ['A', 'B', 'C', 'D'].indexOf(question.correct_option);

      if (question.image) {
        await ctx.replyWithPhoto({ url: question.image });
      }

      await ctx.sendPoll(question.question, options, {
        type: 'quiz',
        correct_option_id: correctOptionIndex,
        is_anonymous: false,
        explanation: question.explanation || 'No explanation provided.',
      } as any);
    }
  } catch (err) {
    debug('Error loading questions:', err);
    await ctx.reply(`Error loading quiz data: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
};

export { quizes };
