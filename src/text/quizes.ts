import { Context } from 'telegraf';
import createDebug from 'debug';

const debug = createDebug('bot:quizes');

const quizes = () => async (ctx: Context) => {
  debug('Triggered "quizes" handler');

  if (!ctx.message || !('text' in ctx.message)) return;

  const text = ctx.message.text.trim();
  const lowerText = text.toLowerCase();

  const legacyMatch = lowerText.match(/^\/(pyq(b|c|p)?|[bcp]1)(\s*\d+)?$/);
  const customMatch = text.match(/^\/pyq\s+(.+?)(?:\s+(\d+))?$/i);

  const subjectMap: Record<string, string> = {
    b: 'biology',
    c: 'chemistry',
    p: 'physics',
  };

  let filterChapter: string | null = null;
  let subject: string | null = null;
  let count = 1;
  let isMixed = false;

  if (legacyMatch) {
    const cmd = legacyMatch[1]; // pyq, pyqb, pyqc, pyqp, b1, c1, p1
    const subjectCode = legacyMatch[2]; // b, c, p
    count = legacyMatch[3] ? parseInt(legacyMatch[3].trim(), 10) : 1;

    if (cmd === 'pyq') {
      isMixed = true;
    } else if (subjectCode) {
      subject = subjectMap[subjectCode];
    } else if (['b1', 'c1', 'p1'].includes(cmd)) {
      subject = subjectMap[cmd[0]];
    }
  } else if (customMatch) {
    filterChapter = customMatch[1].trim().toLowerCase(); // e.g., 'living world'
    count = customMatch[2] ? parseInt(customMatch[2].trim(), 10) : 1;
    isMixed = true;
  } else {
    return; // not a supported command
  }

  try {
    const response = await fetch('https://raw.githubusercontent.com/itzfew/Eduhub-KMR/master/quiz.json');
    const allQuestions = await response.json();

    let filtered = allQuestions;

    if (!isMixed && subject) {
      filtered = allQuestions.filter((q: any) => q.subject?.toLowerCase() === subject);
    }

    if (filterChapter) {
      filtered = filtered.filter((q: any) => q.chapter?.toLowerCase() === filterChapter);
    }

    if (!filtered.length) {
      await ctx.reply(`No questions available for ${filterChapter || subject || 'the selected input'}.`);
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
    debug('Error fetching questions:', err);
    await ctx.reply('Oops! Failed to load questions.');
  }
};

export { quizes };
