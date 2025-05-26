import { Context } from 'telegraf';
import createDebug from 'debug';

const debug = createDebug('bot:quizes');

const quizes = () => async (ctx: Context) => {
  debug('Triggered "quizes" handler');

  if (!ctx.message || !('text' in ctx.message)) return;

  const text = ctx.message.text.trim().toLowerCase();
  const chapterMatch = text.match(/^\/chapter\s+(.+?)(?:\s+(\d+))?$/);
  const cmdMatch = text.match(/^\/(pyq(b|c|p)?|[bcp]1)(\s*\d+)?$/);

  // Function to fetch all questions
  const fetchQuestions = async () => {
    try {
      const response = await fetch('https://raw.githubusercontent.com/itzfew/Eduhub-KMR/refs/heads/main/quiz.json');
      return await response.json();
    } catch (err) {
      debug('Error fetching questions:', err);
      throw err;
    }
  };

  // Function to get unique chapters
  const getUniqueChapters = (questions: any[]) => {
    const chapters = new Set(questions.map((q: any) => q.chapter?.trim()));
    return Array.from(chapters).filter(ch => ch).sort();
  };

  // Function to send paginated chapters list
  const sendChaptersList = async (chapters: string[], page: number = 1, perPage: number = 10) => {
    const totalPages = Math.ceil(chapters.length / perPage);
    const start = (page - 1) * perPage;
    const end = start + perPage;
    const paginatedChapters = chapters.slice(start, end);

    let message = `Available chapters (Page ${page}/${totalPages}):\n`;
    message += paginatedChapters.map(ch => `/chapter ${ch} <number>`).join('\n');

    const buttons: any[] = [];
    if (page > 1) buttons.push({ text: '⬅️ Previous', callback_data: `chapters:${page - 1}` });
    if (page < totalPages) buttons.push({ text: 'Next ➡️', callback_data: `chapters:${page + 1}` });

    await ctx.reply(message, {
      reply_markup: {
        inline_keyboard: [buttons],
      },
    });
  };

  // Handle callback queries for pagination
  if ('callback_query' in ctx && ctx.callbackQuery && 'data' in ctx.callbackQuery) {
    const data = ctx.callbackQuery.data;
    if (data.startsWith('chapters:')) {
      const page = parseInt(data.split(':')[1], 10);
      try {
        const allQuestions = await fetchQuestions();
        const chapters = getUniqueChapters(allQuestions);
        await sendChaptersList(chapters, page);
      } catch (err) {
        await ctx.reply('Failed to load chapters.');
      }
      return;
    }
  }

  // Handle /chapter command
  if (chapterMatch) {
    const chapterName = chapterMatch[1].trim();
    const count = chapterMatch[2] ? parseInt(chapterMatch[2], 10) : 1;

    try {
      const allQuestions = await fetchQuestions();
      const filteredByChapter = allQuestions.filter(
        (q: any) => q.chapter?.toLowerCase().trim() === chapterName.toLowerCase()
      );

      // Check if chapter exists
      if (!filteredByChapter.length) {
        const chapters = getUniqueChapters(allQuestions);
        await ctx.reply(
          `Dear user, no questions found for chapter "${chapterName}".\n` +
          `Please use a valid chapter name, e.g., /chapter living world 2 for 2 questions.\n` +
          `Click below to see all available chapters:`,
          {
            reply_markup: {
              inline_keyboard: [[{ text: '📚 View All Chapters', callback_data: 'chapters:1' }]],
            },
          }
        );
        return;
      }

      // Select random questions
      const shuffled = filteredByChapter.sort(() => 0.5 - Math.random());
      const selected = shuffled.slice(0, Math.min(count, filteredByChapter.length));

      if (!selected.length) {
        await ctx.reply(`No questions available for chapter "${chapterName}".`);
        return;
      }

      // Send questions as polls
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
    return;
  }

  // Existing /pyq, /b1, /c1, /p1 command handling
  if (cmdMatch) {
    const cmd = cmdMatch[1]; // pyq, pyqb, pyqc, pyqp, b1, c1, p1
    const subjectCode = cmdMatch[2]; // b, c, p
    const count = cmdMatch[3] ? parseInt(cmdMatch[3].trim(), 10) : 1;

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
      const allQuestions = await fetchQuestions();
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
      debug('Error fetching questions:', err);
      await ctx.reply('Oops! Failed to load questions.');
    }
  }
};

export { quizes, handleQuizActions};
