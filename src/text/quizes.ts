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

  // Function to create and publish Telegraph page with chapters
  const createTelegraphPage = async (chapters: string[]) => {
    try {
      const content = [
        { tag: 'h1', children: ['Available Chapters'] },
        { tag: 'p', children: ['Copy and paste any chapter name with /chapter command to get quizzes. Example: /chapter living world 2'] },
        ...chapters.map(ch => ({
          tag: 'p',
          children: [`/chapter ${ch}`],
        })),
      ];

      const response = await fetch('https://api.telegra.ph/createPage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_token: 'YOUR_TELEGRAPH_ACCESS_TOKEN', // Replace with your Telegraph access token
          title: 'Available Quiz Chapters',
          content: JSON.stringify(content),
          return_content: false,
        }),
      });

      const result = await response.json();
      if (result.ok) {
        return result.result.url;
      } else {
        throw new Error('Failed to create Telegraph page');
      }
    } catch (err) {
      debug('Error creating Telegraph page:', err);
      throw err;
    }
  };

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
        const telegraphUrl = await createTelegraphPage(chapters);
        await ctx.reply(
          `No questions found for chapter "${chapterName}".\n` +
          `Please use a valid chapter name. Visit this link to see all available chapters: ${telegraphUrl}`
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

export { quizes };
