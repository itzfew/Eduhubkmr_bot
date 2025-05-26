import { Context } from 'telegraf';
import createDebug from 'debug';
import { InlineKeyboardMarkup } from 'telegraf/typings/core/types/typegram';

const debug = createDebug('bot:quizes');

const PAGE_SIZE = 8;

const quizes = () => async (ctx: Context) => {
  debug('Triggered "quizes" handler');

  if (!ctx.message || !('text' in ctx.message)) return;

  const text = ctx.message.text.trim().toLowerCase();
  const pyqMatch = text.match(/^\/(pyq(b|c|p)?|[bcp]1)(\s*\d+)?$/);
  const chapterMatch = text.match(/^\/chapter\s+([a-z0-9\s\-]+)?\s*(\d+)?$/i);

  const response = await fetch('https://raw.githubusercontent.com/itzfew/Eduhub-KMR/refs/heads/main/quiz.json');
  const allQuestions = await response.json();

  // Handle /chapter <chapter name> <count?>
  if (chapterMatch) {
    const chapter = chapterMatch[1]?.trim().toLowerCase();
    const count = chapterMatch[2] ? parseInt(chapterMatch[2], 10) : 1;

    if (!chapter) {
      return sendHelpWithChapters(ctx, allQuestions, 1);
    }

    const filtered = allQuestions.filter(
      (q: any) => q.chapter?.toLowerCase() === chapter
    );

    if (!filtered.length) {
      return ctx.reply(`Dear, please use the correct chapter name.\nTry /chapter living world 2\n\nHere are available chapters:`, {
        reply_markup: await getChaptersKeyboard(allQuestions, 1)
      });
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
        explanation: question.explanation || 'No explanation provided.'
      } as any);
    }
    return;
  }

  // Handle /pyq, /b1, /c1, etc.
  if (!pyqMatch) return;

  const cmd = pyqMatch[1];
  const subjectCode = pyqMatch[2];
  const count = pyqMatch[3] ? parseInt(pyqMatch[3].trim(), 10) : 1;

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

  const filtered = isMixed
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
      explanation: question.explanation || 'No explanation provided.'
    } as any);
  }
};

async function sendHelpWithChapters(ctx: Context, questions: any[], page = 1) {
  await ctx.reply(
    `Dear, please include correct chapter name like:\n\n/chapters living world 2 (for 2 questions)\n\nHere are the available chapters:`,
    { reply_markup: await getChaptersKeyboard(questions, page) }
  );
}

async function getChaptersKeyboard(questions: any[], page: number): Promise<InlineKeyboardMarkup> {
  const allChapters = Array.from(
    new Set(questions.map((q: any) => q.chapter?.trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));

  const start = (page - 1) * PAGE_SIZE;
  const end = start + PAGE_SIZE;
  const pageChapters = allChapters.slice(start, end);

  const buttons = pageChapters.map((ch) => [{
    text: ch,
    callback_data: `chapter_${ch.replace(/\s+/g, '_').toLowerCase()}`
  }]);

  const totalPages = Math.ceil(allChapters.length / PAGE_SIZE);
  const navButtons = [];

  if (page > 1) navButtons.push({ text: '« Prev', callback_data: `chapters_page_${page - 1}` });
  if (page < totalPages) navButtons.push({ text: 'Next »', callback_data: `chapters_page_${page + 1}` });

  if (navButtons.length) buttons.push(navButtons);

  return { inline_keyboard: buttons };
}

export { quizes };
