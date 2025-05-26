import { Context } from 'telegraf';
import createDebug from 'debug';
import { TelegraPh } from 'telegraph-uploader'; // You'll need to install this package

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

  // Function to create a Telegraph page with chapters list
  const createTelegraphPage = async (chapters: string[]) => {
    try {
      const telegraph = new TelegraPh();
      
      // Generate current date and time for the title
      const now = new Date();
      const dateTimeString = now.toLocaleString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short'
      });
      
      // Create HTML content for the page
      let content = '<h4>📚 Available Chapters</h4><br/>';
      content += `<p><i>Last updated: ${dateTimeString}</i></p><br/>`;
      
      // Add chapters list
      content += '<ul>';
      chapters.forEach(chapter => {
        content += `<li>${chapter}</li>`;
      });
      content += '</ul><br/>';
      
      content += '<p>To get questions from a chapter, use:</p>';
      content += '<code>/chapter [name] [count]</code><br/>';
      content += '<p>Example:</p>';
      content += '<code>/chapter living world 2</code>';
      
      // Create the page
      const page = await telegraph.createPage({
        title: `EduHub Chapters - ${dateTimeString}`,
        author_name: 'EduHub Bot',
        author_url: 'https://t.me/your_bot_username',
        content: content
      });
      
      return page.url;
    } catch (err) {
      debug('Error creating Telegraph page:', err);
      throw err;
    }
  };

  // Function to generate chapters list message with Telegraph link
  const getChaptersMessage = async () => {
    try {
      const allQuestions = await fetchQuestions();
      const chapters = getUniqueChapters(allQuestions);
      
      // Create a new Telegraph page
      const telegraphUrl = await createTelegraphPage(chapters);
      
      return {
        message: `📚 <b>Available Chapters</b>\n\n` +
                `View all chapters here: <a href="${telegraphUrl}">${telegraphUrl}</a>\n\n` +
                `Then use: <code>/chapter [name] [count]</code>\n` +
                `Example: <code>/chapter living world 2</code>`,
        chapters
      };
    } catch (err) {
      debug('Error generating chapters message:', err);
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
        const { message } = await getChaptersMessage();
        await ctx.replyWithHTML(
          `❌ No questions found for chapter "<b>${chapterName}</b>"\n\n${message}`
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
