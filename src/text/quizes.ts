import { Context } from 'telegraf';
import createDebug from 'debug';
import Telegraph from 'node-telegraph';

const debug = createDebug('bot:quizes');

// Initialize Telegraph with your access token
const telegraph = new Telegraph('YOUR_TELEGRAPH_ACCESS_TOKEN');

const quizes = () => async (ctx: Context) => {
  debug('Triggered "quizes" handler');

  if (!ctx.message || !('text' in ctx.message)) return;

  const text = ctx.message.text.trim().toLowerCase();
  const chapterMatch = text.match(/^\/chapter\s+(.+?)(?:\s+(\d+))?$/);

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

  // Function to create Telegraph content
  const createTelegraphContent = (questions: any[]) => {
    // Group questions by subject
    const groupedBySubject: Record<string, any[]> = {
      biology: [],
      chemistry: [],
      physics: [],
    };

    questions.forEach((q) => {
      const subject = q.subject?.toLowerCase();
      if (subject in groupedBySubject) {
        groupedBySubject[subject].push(q);
      }
    });

    // Create Telegraph nodes
    const nodes: any[] = [];

    Object.entries(groupedBySubject).forEach(([subject, questions]) => {
      if (questions.length > 0) {
        nodes.push({ tag: 'h3', children: [subject.toUpperCase()] });
        questions.forEach((q, index) => {
          nodes.push({ tag: 'p', children: [`${index + 1}. ${q.question}`] });
          nodes.push({
            tag: 'ul',
            children: [
              { tag: 'li', children: [`A. ${q.options.A}`] },
              { tag: 'li', children: [`B. ${q.options.B}`] },
              { tag: 'li', children: [`C. ${q.options.C}`] },
              { tag: 'li', children: [`D. ${q.options.D}`] },
            ],
          });
          nodes.push({ tag: 'p', children: [`Correct Answer: ${q.correct_option}`] });
          if (q.explanation) {
            nodes.push({ tag: 'p', children: [`Explanation: ${q.explanation}`] });
          }
          if (q.image) {
            nodes.push({ tag: 'img', attrs: { src: q.image } });
          }
        });
      }
    });

    return nodes;
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
        await ctx.reply(
          `Dear user, no questions found for chapter "${chapterName}".\n` +
          `Please use a valid chapter name, e.g., /chapter living world 2 for 2 questions.`
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

      // Create Telegraph page
      const telegraphContent = createTelegraphContent(selected);
      const page = await telegraph.createPage({
        title: `Quiz: ${chapterName} (${count} Questions)`,
        content: telegraphContent,
        author_name: 'Eduhub-KMR Bot',
      });

      // Send Telegraph link
      await ctx.reply(`Here are your quiz questions for "${chapterName}":\n${page.url}`);

      // Optionally, send questions as polls
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
      debug('Error processing request:', err);
      await ctx.reply('Oops! Failed to load questions or create Telegraph page.');
    }
    return;
  }
};

export { quizes };
