// src/text/quizes.ts
import { Context } from 'telegraf';
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

// Interface for group settings
interface GroupSettings {
  quizInterval?: number; // Interval in minutes
}

// Interface for a question
interface Question {
  question: string;
  options: { A: string; B: string; C: string; D: string };
  correct_option: 'A' | 'B' | 'C' | 'D';
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
    debug(`Error saving settings for chat ${chatId}: ${err}`);
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
    debug(`Error removing settings for chat ${chatId}: ${err}`);
    throw err;
  }
};

// Function to validate a question
const isValidQuestion = (question: any): question is Question => {
  return (
    question &&
    typeof question.question === 'string' &&
    question.question.trim() !== '' &&
    question.options &&
    typeof question.options === 'object' &&
    ['A', 'B', 'C', 'D'].every(
      key => typeof question.options[key] === 'string' && question.options[key].trim() !== ''
    ) &&
    ['A', 'B', 'C', 'D'].includes(question.correct_option) &&
    (!question.image || typeof question.image === 'string') &&
    (!question.explanation || typeof question.explanation === 'string') &&
    (!question.chapter || typeof question.chapter === 'string')
  );
};

// Function to check if an image URL is accessible
const isImageAccessible = async (url: string): Promise<boolean> => {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    return response.ok && response.headers.get('content-type')?.startsWith('image/') === true;
  } catch (err) {
    debug(`Image URL inaccessible: ${url}, Error: ${err}`);
    return false;
  }
};

// Function to fetch questions with validation
const fetchQuestions = async (subject?: string): Promise<Question[]> => {
  try {
    let allQuestions: any[] = [];
    if (subject) {
      if (!JSON_FILES[subject]) {
        throw new Error(`Invalid subject: ${subject}`);
      }
      const response = await fetch(JSON_FILES[subject]);
      if (!response.ok) {
        throw new Error(`Failed to fetch ${subject} questions: ${response.statusText}`);
      }
      const data = await response.json();
      if (!Array.isArray(data)) {
        throw new Error(`Invalid data format for ${subject} questions`);
      }
      allQuestions = data;
    } else {
      const subjects = Object.keys(JSON_FILES);
      for (const subj of subjects) {
        const response = await fetch(JSON_FILES[subj]);
        if (!response.ok) {
          debug(`Failed to fetch ${subj} questions: ${response.statusText}`);
          continue;
        }
        const data = await response.json();
        if (!Array.isArray(data)) {
          debug(`Invalid data format for ${subj} questions`);
          continue;
        }
        allQuestions.push(...data);
      }
    }

    // Filter and validate questions
    const validQuestions = allQuestions.filter(isValidQuestion);
    if (validQuestions.length === 0) {
      throw new Error('No valid questions found after filtering');
    }

    debug(`Fetched ${validQuestions.length} valid questions for ${subject || 'all subjects'}`);
    return validQuestions;
  } catch (err) {
    debug(`Error fetching questions: ${err}`);
    throw err;
  }
};

// Function to send a random question
const sendRandomQuestion = async (ctx: Context, subject?: string) => {
  try {
    const questions = await fetchQuestions(subject);
    if (!questions.length) {
      await ctx.reply(`No valid questions available for ${subject || 'the selected subjects'}.`);
      return;
    }

    // Randomly select a question
    const question = questions[Math.floor(Math.random() * questions.length)];
    const options = [
      question.options.A,
      question.options.B,
      question.options.C,
      question.options.D,
    ];
    const correctOptionIndex = ['A', 'B', 'C', 'D'].indexOf(question.correct_option);

    // Send image if present and accessible
    if (question.image) {
      const isAccessible = await isImageAccessible(question.image);
      if (isAccessible) {
        try {
          await ctx.replyWithPhoto({ url: question.image });
        } catch (err) {
          debug(`Failed to send image for question: ${question.image}, Error: ${err}`);
          // Continue without the image
        }
      } else {
        debug(`Skipping inaccessible image: ${question.image}`);
      }
    }

    // Send the poll
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
    debug(`Sent question: ${question.question.substring(0, 50)}...`);
  } catch (err) {
    debug(`Error in sendRandomQuestion: ${err}`);
    await ctx.reply(
      `Failed to send a random question. Please try again later or contact support if the issue persists.`
    );
  }
};

// Function to setup auto quiz for a chat
const setupAutoQuiz = (ctx: Context, chatId: string, intervalMinutes: number) => {
  if (quizIntervals[chatId]) {
    clearInterval(quizIntervals[chatId]);
    delete quizIntervals[chatId];
  }

  const intervalMs = intervalMinutes * 60 * 1000;
  quizIntervals[chatId] = setInterval(async () => {
    try {
      await sendRandomQuestion(ctx);
    } catch (err) {
      debug(`Auto quiz error for chat ${chatId}: ${err}`);
      // Optionally notify admins
      try {
        await ctx.reply(
          `Auto quiz failed to send a question. Please check the bot's configuration or contact support.`
        );
      } catch (notifyErr) {
        debug(`Failed to notify admins for chat ${chatId}: ${notifyErr}`);
      }
    }
  }, intervalMs);

  debug(`Auto quiz set for chat ${chatId} every ${intervalMinutes} minutes`);
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
      debug(`Error checking admin status: ${err}`);
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
      setupAutoQuiz(ctx, chatId, intervalMinutes);
      await ctx.reply(`Auto quiz set to send a random question every ${intervalMinutes} minutes.`);
    } catch (err) {
      debug(`Error setting up auto quiz: ${err}`);
      await ctx.reply('Error setting up auto quiz. Please try again or contact support.');
    }
    return;
  }

  if (removeQuizTimeMatch && (await isAdmin())) {
    try {
      await removeGroupSettings(chatId);
      clearAutoQuiz(chatId);
      await ctx.reply('Auto quiz scheduling has been removed.');
    } catch (err) {
      debug(`Error removing auto quiz: ${err}`);
      await ctx.reply('Error removing auto quiz. Please try again or contact support.');
    }
    return;
  }

  // ... (rest of the quizes function remains unchanged, including createTelegraphAccount, getUniqueChapters, createTelegraphPage, getChaptersMessage, and command handling for /chapter and /pyq)

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
          const isAccessible = await isImageAccessible(question.image);
          if (isAccessible) {
            try {
              await ctx.replyWithPhoto({ url: question.image });
            } catch (err) {
              debug(`Failed to send image for question: ${question.image}, Error: ${err}`);
            }
          } else {
            debug(`Skipping inaccessible image: ${question.image}`);
          }
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
      debug(`Error fetching questions for chapter: ${err}`);
      await ctx.reply('Failed to load questions. Please try again or contact support.');
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
        await ctx.reply(`No valid questions available for ${subject || 'the selected subjects'}.`);
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
          const isAccessible = await isImageAccessible(question.image);
          if (isAccessible) {
            try {
              await ctx.replyWithPhoto({ url: question.image });
            } catch (err) {
              debug(`Failed to send image for question: ${question.image}, Error: ${err}`);
            }
          } else {
            debug(`Skipping inaccessible image: ${question.image}`);
          }
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
      debug(`Error fetching questions for command: ${err}`);
      await ctx.reply('Failed to load questions. Please try again or contact support.');
    }
  }
};

// Initialize auto quizzes for all groups
const initializeAutoQuizzes = async (bot: any) => {
  const settingsRef = ref(db, 'groups');
  onValue(settingsRef, (snapshot) => {
    const groups = snapshot.val();
    if (!groups) {
      debug('No group settings found in Firebase');
      return;
    }

    Object.entries(groups).forEach(([chatId, group]: [string, any]) => {
      if (group.settings?.quizInterval) {
        const ctx = {
          chat: { id: parseInt(chatId) },
          reply: async (message: string) => {
            try {
              return await bot.telegram.sendMessage(chatId, message);
            } catch (err) {
              debug(`Failed to send message to chat ${chatId}: ${err}`);
              throw err;
            }
          },
          replyWithPhoto: async (photo: any) => {
            try {
              return await bot.telegram.sendPhoto(chatId, photo);
            } catch (err) {
              debug(`Failed to send photo to chat ${chatId}: ${err}`);
              throw err;
            }
          },
          sendPoll: async (question: string, options: string[], optionsObj: any) => {
            try {
              return await bot.telegram.sendPoll(chatId, question, options, optionsObj);
            } catch (err) {
              debug(`Failed to send poll to chat ${chatId}: ${err}`);
              throw err;
            }
          },
          getChatMember: async (userId: number) => {
            try {
              return await bot.telegram.getChatMember(chatId, userId);
            } catch (err) {
              debug(`Failed to get chat member for chat ${chatId}: ${err}`);
              throw err;
            }
          },
        } as Context;

        setupAutoQuiz(ctx, chatId, group.settings.quizInterval);
        debug(`Initialized auto quiz for chat ${chatId} with interval ${group.settings.quizInterval} minutes`);
      }
    });
  }, {
    onlyOnce: false, // Ensure continuous listening for changes
  });
};

export { quizes, initializeAutoQuizzes };
