import { Context, Telegraf } from 'telegraf';
import createDebug from 'debug';
import { distance } from 'fastest-levenshtein';
import { getAllChatIds } from '../utils/chatStore';

const debug = createDebug('bot:quizes');

let accessToken: string | null = null;

// Base URL for JSON files
const BASE_URL = 'https://raw.githubusercontent.com/itzfew/Eduhub-KMR/refs/heads/main/';

// Subject-specific JSON file paths
const JSON_FILES: Record<string, string> = {
  biology: `${BASE_URL}biology.json`,
  chemistry: `${BASE_URL}chemistry.json`,
  physics: `${BASE_URL}physics.json`,
};

// Store allowed chat IDs for automatic quizzes (in-memory cache)
let allowedChatIds: number[] = [];

// Google Apps Script endpoint for allowed chat IDs
const ALLOWED_CHAT_IDS_URL = 'https://script.google.com/macros/s/AKfycbzHPhcv79YQyIx6t-59fsc6Czm9WgL6Y4HOP2JgX4gJyi3KjZqbXOGY-zmpyceW32VI/exec';

// Function to fetch allowed chat IDs from Google Sheets
const fetchAllowedChatIds = async (): Promise<number[]> => {
  try {
    const response = await fetch(`${ALLOWED_CHAT_IDS_URL}?action=get`, {
      method: 'GET',
    });
    const data = await response.json();
    return data.map((id: string) => Number(id)).filter((id: number) => !isNaN(id));
  } catch (error) {
    debug('Failed to fetch allowed chat IDs:', error);
    return [];
  }
};

// Function to save allowed chat ID to Google Sheets
const saveAllowedChatIdToSheet = async (chatId: number): Promise<boolean> => {
  try {
    const response = await fetch(ALLOWED_CHAT_IDS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: String(chatId), action: 'allow' }),
    });
    const result = await response.text();
    return result === 'Saved';
  } catch (error) {
    debug('Error saving allowed chat ID:', error);
    return false;
  }
};

// Function to remove allowed chat ID from Google Sheets
const removeAllowedChatIdFromSheet = async (chatId: number): Promise<boolean> => {
  try {
    const response = await fetch(ALLOWED_CHAT_IDS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: String(chatId), action: 'disallow' }),
    });
    const result = await response.text();
    return result === 'Removed';
  } catch (error) {
    debug('Error removing allowed chat ID:', error);
    return false;
  }
};

// Function to calculate similarity score between two strings
const getSimilarityScore = (a: string, b: string): number => {
  const maxLength = Math.max(a.length, b.length);
  if (maxLength === 0) return 1.0;
  return (maxLength - distance(a, b)) / maxLength;
};

// Function to find best matching chapter using fuzzy search
const findBestMatchingChapter = (chapters: string[], query: string): string | null => {
  if (!query || !chapters.length) return null;

  const exactMatch = chapters.find(ch => ch.toLowerCase() === query.toLowerCase());
  if (exactMatch) return exactMatch;

  const containsMatch = chapters.find(ch =>
    ch.toLowerCase().includes(query.toLowerCase()) ||
    query.toLowerCase().includes(ch.toLowerCase())
  );
  if (containsMatch) return containsMatch;

  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  let bestMatch: string | null = null;
  let bestScore = 0.5;

  for (const chapter of chapters) {
    const chapterWords = chapter.toLowerCase().split(/\s+/);
    const matchingWords = queryWords.filter(qw =>
      chapterWords.some(cw => getSimilarityScore(qw, cw) > 0.7)
    );
    const overlapScore = matchingWords.length / Math.max(queryWords.length, 1);
    const fullSimilarity = getSimilarityScore(chapter.toLowerCase(), query.toLowerCase());
    const totalScore = (overlapScore * 0.7) + (fullSimilarity * 0.3);

    if (totalScore > bestScore) {
      bestScore = totalScore;
      bestMatch = chapter;
    }
  }

  return bestMatch;
};

// Function to create a Telegraph account
const createTelegraphAccount = async () => {
  try {
    const res = await fetch('https://api.telegra.ph/createAccount', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        short_name: 'EduHubBot',
        author_name: 'EduHub Bot',
        author_url: 'https://t.me/neetpw01',
      }),
    });
    const data = await res.json();
    if (data.ok) {
      accessToken = data.result.access_token;
      debug('Telegraph account created successfully');
    } else {
      throw new Error(data.error);
    }
  } catch (err) {
    debug('Error creating Telegraph account:', err);
    throw err;
  }
};

// Function to fetch questions
const fetchQuestions = async (subject?: string): Promise<any[]> => {
  try {
    if (subject) {
      const response = await fetch(JSON_FILES[subject]);
      if (!response.ok) {
        throw new Error(`Failed to fetch ${subject} questions: ${response.statusText}`);
      }
      return await response.json();
    } else {
      const subjects = Object.keys(JSON_FILES);
      const allQuestions: any[] = [];
      for (const subj of subjects) {
        const response = await fetch(JSON_FILES[subj]);
        if (!response.ok) {
          debug(`Failed to fetch ${subj} questions: ${response.statusText}`);
          continue;
        }
        const questions = await response.json();
        allQuestions.push(...questions);
      }
      return allQuestions;
    }
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
    if (!accessToken) {
      await createTelegraphAccount();
    }

    const now = new Date();
    const dateTimeString = now.toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    });

    let content = [
      { tag: 'h4', children: ['📚 Available Chapters'] },
      { tag: 'br' },
      { tag: 'p', children: [{ tag: 'i', children: [`Last updated: ${dateTimeString}`] }] },
      { tag: 'br' },
      {
        tag: 'ul',
        children: chapters.map(chapter => ({
          tag: 'li',
          children: [chapter],
        }),
      },
      {

 tag: 'br' },
      { tag: 'p', children: ['To get questions from a chapter, use:'] },
      { tag: 'code', children: ['/chapter [name] [count]'] },
      { tag: 'br' },
      { tag: 'p', children: ['Example:'] },
      { tag: 'code', children: ['/chapter living world 2'] },
    ];

    const res = await fetch('https://api.telegra.ph/createPage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: accessToken,
        title: `EduHub Chapters - ${dateTimeString}`,
        author_name: 'EduHub Bot',
        author_url: 'https://t.me/neetpw01',
        content: content,
        return_content: false,
      }),
    });
    const data = await res.json();
    if (data.ok) {
      return data.result.url;
    } else {
      throw new Error(data.error);
    }
  } catch (err) {
    debug('Error creating Telegraph page:', err);
    throw err;
  }
};

// Function to generate chapters list message
const getChaptersMessage = async () => {
  try {
    const allQuestions = await fetchQuestions();
    const chapters = getUniqueChapters(allQuestions);
    const telegraphUrl = await createTelegraphPage(chapters);
    return {
      message: `📚 <b>Available Chapters</b>\n\n` +
        `View all chapters here: <a href="${telegraphUrl}">${telegraphUrl}</a>\n\n` +
        `Then use: <code>/chapter [name] [count]</code>\n` +
        `Example: <code>/chapter living world 2</code>`,
      chapters,
    };
  } catch (err) {
    debug('Error generating chapters message:', err);
    throw err;
  }
};

// Function to send a quiz to a specific chat
const sendQuiz = async (bot: Telegraf<Context>, ctx: Context | null, chatId?: number) => {
  try {
    const allQuestions = await fetchQuestions();
    if (!allQuestions.length) {
      if (ctx) await ctx.reply('No questions available.');
      return;
    }

    const shuffled = allQuestions.sort(() => 0.5 - Math.random());
    const question = shuffled[0];

    const options = [
      question.options.A,
      question.options.B,
      question.options.C,
      question.options.D,
    ];
    const correctOptionIndex = ['A', 'B', 'C', 'D'].indexOf(question.correct_option);

    if (question.image) {
      if (ctx) {
        await ctx.replyWithPhoto({ url: question.image });
      } else if (chatId) {
        await bot.telegram.sendPhoto(chatId, { url: question.image });
      }
    }

    const pollOptions = {
      type: 'quiz',
      correct_option_id: correctOptionIndex,
      is_anonymous: false,
      explanation: question.explanation || 'No explanation provided.',
    } as any;

    if (ctx) {
      await ctx.sendPoll(question.question, options, pollOptions);
    } else if (chatId) {
      await bot.telegram.sendPoll(chatId, question.question, options, pollOptions);
    }
  } catch (err) {
    debug('Error sending quiz:', err);
    if (ctx) await ctx.reply('Oops! Failed to load questions.');
  }
};

// Automatic quiz sending function
export const sendAutomaticQuizzes = async (bot: Telegraf<Context>) => {
  // Sync allowed chat IDs from Google Sheets
  allowedChatIds = await fetchAllowedChatIds();
  const chatIds = getAllChatIds().filter(id => allowedChatIds.includes(id));
  for (const chatId of chatIds) {
    try {
      await sendQuiz(bot, null, chatId);
      debug(`Sent quiz to chat ${chatId}`);
    } catch (err) {
      debug(`Failed to send quiz to chat ${chatId}:`, err);
    }
  }
};

export const quizes = () => async (ctx: Context) => {
  debug('Triggered "quizes" handler');

  if (!ctx.message || !('text' in ctx.message)) return;

  const text = ctx.message.text.trim().toLowerCase();
  const chapterMatch = text.match(/^\/chapter\s+(.+?)(?:\s+(\d+))?$/);
  const cmdMatch = text.match(/^\/(pyq(b|c|p)?|[bcp]1)(\s*\d+)?$/);
  const quizAllowMatch = text.match(/^\/quiz\s+(allow|disallow)$/);

  // Handle /quiz allow or /quiz disallow
  if (quizAllowMatch) {
    const action = quizAllowMatch[1];
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    // Check if the user is an admin
    const admins = await ctx.getChatAdministrators();
    const isAdmin = admins.some(admin => admin.user.id === ctx.from?.id);

    if (!isAdmin) {
      await ctx.reply('Only group admins can use /quiz allow or /quiz disallow.');
      return;
    }

    if (action === 'allow') {
      const saved = await saveAllowedChatIdToSheet(chatId);
      if (saved) {
        allowedChatIds.push(chatId);
        await ctx.reply('Automatic quizzes enabled for this group. Quizzes will be sent every minute.');
      } else {
        await ctx.reply('Automatic quizzes are already enabled for this group.');
      }
    } else if (action === 'disallow') {
      const removed = await removeAllowedChatIdFromSheet(chatId);
      if (removed) {
        allowedChatIds = allowedChatIds.filter(id => id !== chatId);
        await ctx.reply('Automatic quizzes disabled for this group.');
      } else {
        await ctx.reply('Automatic quizzes are not enabled for this group.');
      }
    }
    return;
  }

  // Handle /chapter command
  if (chapterMatch) {
    const chapterQuery = chapterMatch[1].trim();
    const count = chapterMatch[2] ? parseInt(chapterMatch[2], 10) : 1;

    try {
      const allQuestions = await fetchQuestions();
      const chapters = getUniqueChapters(allQuestions);
      const matchedChapter = findBestMatchingChapter(chapters, chapterQuery);

      if (!matchedChapter) {
        const { message } = await getChaptersMessage();
        await ctx.replyWithHTML(
          `❌ No matching chapter found for "<b>${chapterQuery}</b>"\n\n${message}`
        );
        return;
      }

      const filteredByChapter = allQuestions.filter(
        (q: any) => q.chapter?.trim() === matchedChapter
      );

      if (!filteredByChapter.length) {
        const { message } = await getChaptersMessage();
        await ctx.replyWithHTML(
          `❌ No questions found for chapter "<b>${matchedChapter}</b>"\n\n${message}`
        );
        return;
      }

      if (matchedChapter.toLowerCase() !== chapterQuery.toLowerCase()) {
        await ctx.replyWithHTML(
          `🔍 Did you mean "<b>${matchedChapter}</b>"?\n\n` +
          `Sending questions from this chapter...\n` +
          `(If this isn't correct, please try again with a more specific chapter name)`
        );
      }

      const shuffled = filteredByChapter.sort(() => 0.5 - Math.random());
      const selected = shuffled.slice(0, Math.min(count, filteredByChapter.length));

      if (!selected.length) {
        await ctx.reply(`No questions available for chapter "${matchedChapter}".`);
        return;
      }

      for (const question of selected) {
        const options = [
          question.options.A,
          question.options.B,
          question.options.C,
          question.options.D,
        ];
        const correctOptionIndex = ['A', 'B', 'C', 'D'].indexOf(question.correct_option);

        if (question.image) {
          await ctx.replyWithPhoto({ url: question.image });
        }

        await ctx.sendPoll(
          question.question,
          options,
          {
            type: 'quiz',
            correct_option_id: correctOptionIndex,
            is_anonymous: false,
            explanation: question.explanation || 'No explanation provided.',
          } as any
        );
      }
    } catch (err) {
      debug('Error fetching questions:', err);
      await ctx.reply('Oops! Failed to load questions.');
    }
    return;
  }

  // Handle /pyq, /b1, /c1, /p1 commands
  if (cmdMatch) {
    const cmd = cmdMatch[1];
    const subjectCode = cmdMatch[2];
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
      const filtered = isMixed ? await fetchQuestions() : await fetchQuestions(subject!);

      if (!filtered.length) {
        await ctx.reply(`No questions available for ${subject || 'the selected subjects'}.`);
        return;
      }

      const shuffled = filtered.sort(() => 0.5 - Math.random());
      const selected = shuffled.slice(0, Math.min(count, filtered.length));

      for (const question of selected) {
        const options = [
          question.options.A,
          question.options.B,
          question.options.C,
          question.options.D,
        ];
        const correctOptionIndex = ['A', 'B', 'C', 'D'].indexOf(question.correct_option);

        if (question.image) {
          await ctx.replyWithPhoto({ url: question.image });
        }

        await ctx.sendPoll(
          question.question,
          options,
          {
            type: 'quiz',
            correct_option_id: correctOptionIndex,
            is_anonymous: false,
            explanation: question.explanation || 'No explanation provided.',
          } as any
        );
      }
    } catch (err) {
      debug('Error fetching questions:', err);
      await ctx.reply('Oops! Failed to load questions.');
    }
  }
};
