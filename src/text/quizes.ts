// src/text/quizes.ts
import { Context, Telegraf } from 'telegraf';
import createDebug from 'debug';
import { distance } from 'fastest-levenshtein';
import { db, ref, set, push, onValue, remove } from '../utils/firebase';

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

// Map to store interval IDs for each chat
const quizIntervals: Record<string, NodeJS.Timeout> = {};

// Map to store the last question sent per chat
const lastQuestions: Record<string, string | null> = {};

// Interface for group settings
interface GroupSettings {
  quizInterval?: number; // Interval in minutes
}

// Interface for a question
interface Question {
  id?: string; // Optional ID field for tracking
  question: string;
  options: { A: string; B: string; C: string; D: string };
  correct_option: string;
  explanation?: string;
  image?: string;
  chapter?: string;
}

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

// Function to save group settings to Firebase
const saveGroupSettings = async (chatId: string, settings: GroupSettings) => {
  try {
    const settingsRef = ref(db, `groups/${chatId}/settings`);
    await set(settingsRef, settings);
    debug(`Saved settings for chat ${chatId}`);
  } catch (err) {
    debug(`Error saving settings for chat ${chatId}:`, err);
    throw err;
  }
};

// Function to remove group settings from Firebase
const removeGroupSettings = async (chatId: string) => {
  try {
    const settingsRef = ref(db, `groups/${chatId}/settings`);
    await remove(settingsRef);
    debug(`Removed settings for chat ${chatId}`);
  } catch (err) {
    debug(`Error removing settings for chat ${chatId}:`, err);
    throw err;
  }
};

// Function to fetch questions with retry logic
const fetchQuestions = async (subject?: string, retries = 3): Promise<Question[]> => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (subject) {
        const response = await fetch(JSON_FILES[subject]);
        if (!response.ok) {
          throw new Error(`Failed to fetch ${subject} questions: ${response.statusText}`);
        }
        const questions = await response.json();
        if (!Array.isArray(questions) || questions.length === 0) {
          throw new Error(`No valid questions found for ${subject}`);
        }
        return questions;
      } else {
        const subjects = Object.keys(JSON_FILES);
        const allQuestions: Question[] = [];
        for (const subj of subjects) {
          const response = await fetch(JSON_FILES[subj]);
          if (!response.ok) {
            debug(`Failed to fetch ${subj} questions: ${response.statusText}`);
            continue;
          }
          const questions = await response.json();
          if (Array.isArray(questions)) {
            allQuestions.push(...questions);
          }
        }
        if (allQuestions.length === 0) {
          throw new Error('No valid questions found across all subjects');
        }
        return allQuestions;
      }
    } catch (err) {
      debug(`Attempt ${attempt} failed to fetch questions:`, err);
      if (attempt === retries) {
        throw err;
      }
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
  return [];
};

// Function to validate a question
const isValidQuestion = (question: Question): boolean => {
  return (
    !!question.question &&
    !!question.options &&
    typeof question.options === 'object' &&
    ['A', 'B', 'C', 'D'].every(key => typeof question.options[key] === 'string' && question.options[key]) &&
    ['A', 'B', 'C', 'D'].includes(question.correct_option)
  );
};

// Function to send a random question
const sendRandomQuestion = async (ctx: Context, subject?: string) => {
  const chatId = ctx.chat?.id.toString();
  if (!chatId) {
    debug('Error: Unable to identify chat in sendRandomQuestion');
    return;
  }

  try {
    const questions = await fetchQuestions(subject);
    if (!questions.length) {
      debug(`No questions available for ${subject || 'the selected subjects'} in chat ${chatId}`);
      await ctx.reply(`No questions available for ${subject || 'the selected subjects'}.`);
      return;
    }

    // Filter out invalid questions
    const validQuestions = questions.filter(isValidQuestion);
    if (!validQuestions.length) {
      debug(`No valid questions available for ${subject || 'the selected subjects'} in chat ${chatId}`);
      await ctx.reply(`No valid questions available for ${subject || 'the selected subjects'}.`);
      return;
    }

    // Exclude the last question sent in this chat
    const lastQuestion = lastQuestions[chatId];
    const availableQuestions = lastQuestion
      ? validQuestions.filter(q => q.id !== lastQuestion && q.question !== lastQuestion)
      : validQuestions;

    if (!availableQuestions.length) {
      debug(`No new questions available for ${subject || 'the selected subjects'} in chat ${chatId}`);
      await ctx.reply(`No new questions available for ${subject || 'the selected subjects'}.`);
      return;
    }

    // Select a random question
    const question = availableQuestions[Math.floor(Math.random() * availableQuestions.length)];

    // Store the question ID or question text as the last sent
    lastQuestions[chatId] = question.id || question.question;

    const options = [
      question.options.A,
      question.options.B,
      question.options.C,
      question.options.D,
    ];
    const correctOptionIndex = ['A', 'B', 'C', 'D'].indexOf(question.correct_option);

    try {
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
      debug(`Successfully sent quiz to chat ${chatId}`);
    } catch (pollError) {
      debug(`Error sending poll or photo to chat ${chatId}:`, pollError);
      await ctx.reply('Failed to send the question. Please try again later.');
    }
  } catch (err) {
    debug(`Error in sendRandomQuestion for chat ${chatId}:`, err);
    await ctx.reply('Oops! Failed to send a random question.');
  }
};

// Function to create a fresh context for a chat
const createContext = (bot: Telegraf<Context>, chatId: string): Context => {
  return {
    chat: { id: parseInt(chatId) },
    reply: async (message: string) => {
      return bot.telegram.sendMessage(chatId, message);
    },
    replyWithPhoto: async (photo: any) => {
      return bot.telegram.sendPhoto(chatId, photo);
    },
    sendPoll: async (question: string, options: string[], optionsObj: any) => {
      return bot.telegram.sendPoll(chatId, question, options, optionsObj);
    },
  } as Context;
};

// Function to setup auto quiz for a chat
const setupAutoQuiz = (bot: Telegraf<Context>, chatId: string, intervalMinutes: number) => {
  if (quizIntervals[chatId]) {
    clearInterval(quizIntervals[chatId]);
    delete quizIntervals[chatId];
    debug(`Cleared existing interval for chat ${chatId}`);
  }

  const intervalMs = intervalMinutes * 60 * 1000;
  quizIntervals[chatId] = setInterval(async () => {
    const ctx = createContext(bot, chatId);
    debug(`Attempting to send auto quiz to chat ${chatId}`);
    await sendRandomQuestion(ctx);
  }, intervalMs);

  debug(`Auto quiz set for chat ${chatId} every ${intervalMinutes} minutes`);

  // Send an immediate quiz to confirm setup
  const ctx = createContext(bot, chatId);
  sendRandomQuestion(ctx).catch(err => {
    debug(`Error sending initial quiz for chat ${chatId}:`, err);
  });
};

// Function to clear auto quiz for a chat
const clearAutoQuiz = (chatId: string) => {
  if (quizIntervals[chatId]) {
    clearInterval(quizIntervals[chatId]);
    delete quizIntervals[chatId];
    debug(`Auto quiz cleared for chat ${chatId}`);
  }
};

const quizes = () => async (ctx: Context) => {
  debug('Triggered "quizes" handler');

  if (!ctx.message || !('text' in ctx.message)) return;

  const text = ctx.message.text.trim().toLowerCase();
  const chapterMatch = text.match(/^\/chapter\s+(.+?)(?:\s+(\d+))?$/);
  const cmdMatch = text.match(/^\/(pyq(b|c|p)?|[bcp]1)(\s*\d+)?$/);
  const setQuizTimeMatch = text.match(/^\/setquiztime\s+(\d+)$/);
  const removeQuizTimeMatch = text.match(/^\/removequiztime$/);

  const chatId = ctx.chat?.id.toString();
  if (!chatId) {
    await ctx.reply('Error: Unable to identify chat.');
    return;
  }

  const isAdmin = async () => {
    if (!ctx.from) return false;
    try {
      const member = await ctx.getChatMember(ctx.from.id);
      return member.status === 'administrator' || member.status === 'creator';
    } catch (err) {
      debug('Error checking admin status:', err);
      return false;
    }
  };

  if (setQuizTimeMatch && (await isAdmin())) {
    const intervalMinutes = parseInt(setQuizTimeMatch[1], 10);
    if (intervalMinutes < 1) {
      await ctx.reply('Please provide a valid interval in minutes (minimum 1).');
      return;
    }

    try {
      await saveGroupSettings(chatId, { quizInterval: intervalMinutes });
      setupAutoQuiz(ctx.telegram, chatId, intervalMinutes);
      await ctx.reply(`Auto quiz set to send a random question every ${intervalMinutes} minutes.`);
    } catch (err) {
      debug(`Error setting up auto quiz for chat ${chatId}:`, err);
      await CTX.reply('Error setting up auto quiz.');
    }
    return;
  }

  if (removeQuizTimeMatch && (await isAdmin())) {
    try {
      await removeGroupSettings(chatId);
      clearAutoQuiz(chatId);
      await ctx.reply('Auto quiz scheduling has been removed.');
    } catch (err) {
      debug(`Error removing auto quiz for chat ${chatId}:`, err);
      await ctx.reply('Error removing auto quiz.');
    }
    return;
  }

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

  const getUniqueChapters = (questions: Question[]) => {
    const chapters = new Set(questions.map((q: Question) => q.chapter?.trim()));
    return Array.from(chapters).filter(ch => ch).sort();
  };

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
          })),
        },
        { tag: 'br' },
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
          author_url: 'https://t.me/your_bot_username',
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
        (q: Question) => q.chapter?.trim() === matchedChapter
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

      const lastQuestion = lastQuestions[chatId];
      const availableQuestions = lastQuestion
        ? filteredByChapter.filter(q => (q.id || q.question) !== lastQuestion)
        : filteredByChapter;

      if (!availableQuestions.length) {
        await ctx.reply(`No new questions available for chapter "${matchedChapter}".`);
        return;
      }

      const shuffled = availableQuestions.sort(() => 0.5 - Math.random());
      const selected = shuffled.slice(0, Math.min(count, availableQuestions.length));

      for (const question of selected) {
        if (!isValidQuestion(question)) {
          debug(`Invalid question data for chapter "${matchedChapter}":`, question);
          continue;
        }

        const options = [
          question.options.A,
          question.options.B,
          question.options.C,
          question.options.D,
        ];
        const correctOptionIndex = ['A', 'B', 'C', 'D'].indexOf(question.correct_option);

        try {
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

          lastQuestions[chatId] = question.id || question.question;
        } catch (pollError) {
          debug('Error sending poll or photo:', pollError);
          await ctx.reply('Failed to send a question. Skipping to the next one.');
        }
      }
    } catch (err) {
      debug('Error fetching questions:', err);
      await ctx.reply('Oops! Failed to load questions.');
    }
    return;
  }

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

      const validQuestions = filtered.filter(isValidQuestion);
      if (!validQuestions.length) {
        await ctx.reply(`No valid questions available for ${subject || 'the selected subjects'}.`);
        return;
      }

      const lastQuestion = lastQuestions[chatId];
      const availableQuestions = lastQuestion
        ? validQuestions.filter(q => (q.id || q.question) !== lastQuestion)
        : validQuestions;

      if (!availableQuestions.length) {
        await ctx.reply(`No new questions available for ${subject || 'the selected subjects'}.`);
        return;
      }

      const shuffled = availableQuestions.sort(() => 0.5 - Math.random());
      const selected = shuffled.slice(0, Math.min(count, availableQuestions.length));

      for (const question of selected) {
        const options = [
          question.options.A,
          question.options.B,
          question.options.C,
          question.options.D,
        ];
        const correctOptionIndex = ['A', 'B', 'C', 'D'].indexOf(question.correct_option);

        try {
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

          lastQuestions[chatId] = question.id || question.question;
        } catch (pollError) {
          debug('Error sending poll or photo:', pollError Alphabetical order is not guaranteed in this message. Please check your spelling. The word you are looking for may be spelled differently in different countries. If you are in the US, please check your spelling and try again. If you are in another country, please use the spelling that is common in your country.', pollError);
          await ctx.reply('Failed to send a question. Skipping to the next one.');
        }
      }
    } catch (err) {
      debug('Error fetching questions:', err);
      await ctx.reply('Oops! Failed to load questions.');
    }
  }
};

// Function to ensure webhook is disabled and initialize auto quizzes
const initializeAutoQuizzes = async (bot: Telegraf<Context>) => {
  // Ensure webhook is disabled with retries
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const webhookInfo = await bot.telegram.getWebhookInfo();
      if (webhookInfo.url) {
        debug(`Webhook active: ${webhookInfo.url}. Deleting webhook (attempt ${attempt})`);
        await bot.telegram.deleteWebhook({ drop_pending_updates: true });
        debug('Webhook deleted successfully');
      } else {
        debug('No webhook active');
        break;
      }
    } catch (err) {
      debug(`Error handling webhook (attempt ${attempt}):`, err);
      if (attempt === maxRetries) {
        debug('Failed to delete webhook after retries');
        throw err;
      }
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }

  const settingsRef = ref(db, 'groups');
  onValue(settingsRef, (snapshot) => {
    const groups = snapshot.val();
    if (!groups) {
      debug('No group settings found in Firebase');
      return;
    }

    debug('Firebase group settings:', groups);

    Object.entries(groups).forEach(([chatId, group]: [string, any]) => {
      if (group.settings?.quizInterval) {
        debug(`Setting up auto quiz for chat ${chatId} with interval ${group.settings.quizInterval} minutes`);
        setupAutoQuiz(bot, chatId, group.settings.quizInterval);
      }
    });
  }, (error) => {
    debug('Error reading Firebase group settings:', error);
  });
};

export { quizes, initializeAutoQuizzes };
