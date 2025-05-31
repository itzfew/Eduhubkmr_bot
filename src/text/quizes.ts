import { Context } from 'telegraf';
import createDebug from 'debug';
import { distance } from 'fastest-levenshtein';
import { db, ref, set, onValue, remove } from '../utils/firebase';

const debug = createDebug('bot:quizes');

let accessToken: string | null = null;
let superAdmins: string[] = [];
const intervalIds: Map<string, NodeJS.Timeout> = new Map();

const BASE_URL = 'https://raw.githubusercontent.com/itzfew/Eduhub-KMR/refs/heads/main/';
const JSON_FILES: Record<string, string> = {
  biology: `${BASE_URL}biology.json`,
  chemistry: `${BASE_URL}chemistry.json`,
  physics: `${BASE_URL}physics.json`,
};

// Interface for question structure
interface Question {
  question: string;
  options: { A: string; B: string; C: string; D: string };
  correct_option: string;
  explanation?: string;
  chapter?: string;
  image?: string;
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

// Function to check if the user is an admin
const isAdmin = async (ctx: Context): Promise<boolean> => {
  if (!ctx.from || !ctx.chat) return false;
  const userId = ctx.from.id.toString();

  if (superAdmins.includes(userId)) {
    debug(`User ${userId} is a super-admin`);
    return true;
  }

  try {
    const chatMember = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id);
    const isAdmin = ['administrator', 'creator'].includes(chatMember.status);
    debug(`User ${userId} admin check: ${isAdmin}`);
    return isAdmin;
  } catch (err) {
    debug('Error checking admin status:', err);
    return false;
  }
};

// Load super-admins from Firebase
const loadSuperAdmins = async () => {
  try {
    const superAdminsRef = ref(db, 'super_admins');
    onValue(superAdminsRef, (snapshot) => {
      const data = snapshot.val();
      superAdmins = data ? Object.values(data) : [];
      debug('Loaded super-admins:', superAdmins);
    }, { onlyOnce: false });
  } catch (err) {
    debug('Error loading super-admins:', err);
  }
};

// Fetch questions for a specific subject or all subjects
const fetchQuestions = async (subject?: string): Promise<Question[]> => {
  try {
    if (subject) {
      debug(`Fetching questions for subject: ${subject}`);
      const response = await fetch(JSON_FILES[subject]);
      if (!response.ok) {
        throw new Error(`Failed to fetch ${subject} questions: ${response.statusText}`);
      }
      const questions = await response.json();
      debug(`Fetched ${questions.length} questions for ${subject}`);
      return questions;
    } else {
      debug('Fetching questions for all subjects');
      const subjects = Object.keys(JSON_FILES);
      const allQuestions: Question[] = [];
      for (const subj of subjects) {
        const response = await fetch(JSON_FILES[subj]);
        if (!response.ok) {
          debug(`Failed to fetch ${subj} questions: ${response.statusText}`);
          continue;
        }
        const questions = await response.json();
        allQuestions.push(...questions);
      }
      debug(`Fetched ${allQuestions.length} questions for all subjects`);
      return allQuestions;
    }
  } catch (err) {
    debug(' 更新された質問の取得エラー:', err);
    throw err;
  }
};

// Send a single random question
const sendRandomQuestion = async (telegram: any, chatId: string, questions: Question[]) => {
  try {
    debug(`Attempting to send question to chat ${chatId}`);
    if (!questions.length) {
      debug(`No questions available for chat ${chatId}`);
      await telegram.sendMessage(chatId, 'No questions available.');
      return;
    }

    const shuffled = questions.sort(() => 0.5 - Math.random());
    const question = shuffled[0];
    debug(`Selected question for chat ${chatId}: ${question.question.substring(0, 50)}...`);

    const options = [
      question.options.A,
      question.options.B,
      question.options.C,
      question.options.D,
    ];
    const correctOptionIndex = ['A', 'B', 'C', 'D'].indexOf(question.correct_option);

    if (question.image) {
      debug(`Sending image for question in chat ${chatId}`);
      await telegram.sendPhoto(chatId, { url: question.image });
    }

    debug(`Sending poll to chat ${chatId}`);
    await telegram.sendPoll(
      chatId,
      question.question,
      options,
      {
        type: 'quiz',
        correct_option_id: correctOptionIndex,
        is_anonymous: false,
        explanation: question.explanation || 'No explanation provided.',
      }
    );
    debug(`Successfully sent question to chat ${chatId}`);
  } catch (err) {
    debug(`Error sending random question to chat ${chatId}:`, err);
    await telegram.sendMessage(chatId, 'Oops! Failed to send a question.');
  }
};

// Start auto-sending questions for a chat
const startAutoSending = async (telegram: any, chatId: string, questions: Question[]) => {
  if (!questions.length) {
    debug(`No questions available for auto-sending in chat ${chatId}`);
    await telegram.sendMessage(chatId, 'No questions available for auto-sending.');
    return;
  }

  if (intervalIds.has(chatId)) {
    debug(`Interval already exists for chat ${chatId}, skipping`);
    return;
  }

  debug(`Starting auto-sending for chat ${chatId} with ${questions.length} questions`);
  const interval = setInterval(async () => {
    try {
      debug(`Interval triggered for chat ${chatId}`);
      await sendRandomQuestion(telegram, chatId, questions);
    } catch (err) {
      debug(`Error in interval for chat ${chatId}:`, err);
      await telegram.sendMessage(chatId, 'Error sending question. Auto-sending stopped.');
      await stopAutoSending(telegram, chatId);
    }
  }, 30 * 60 * 1000); // 30 minute interval
  intervalIds.set(chatId, interval);
  debug(`Interval set for chat ${chatId}`);
};

// Stop auto-sending for a chat
const stopAutoSending = async (telegram: any, chatId: string) => {
  const interval = intervalIds.get(chatId);
  if (interval) {
    debug(`Stopping auto-sending for chat ${chatId}`);
    clearInterval(interval);
    intervalIds.delete(chatId);
    try {
      await remove(ref(db, `settime_groups/${chatId}`));
      debug(`Removed chat ${chatId} from settime_groups`);
      await telegram.sendMessage(chatId, '⏰ Stopped automatic question sending in this chat.');
    } catch (err) {
      debug('Error removing settime group from Firebase:', err);
    }
  } else {
    debug(`No interval found for chat ${chatId}`);
    await telegram.sendMessage(chatId, '⏰ Automatic question sending is not active in this chat.');
  }
};

// Load active settime groups from Firebase
const loadSetTimeGroups = async (telegram: any) => {
  try {
    debug('Loading settime groups from Firebase');
    const setTimeRef = ref(db, 'settime_groups');
    onValue(setTimeRef, async (snapshot) => {
      debug('settime_groups snapshot received');
      const data = snapshot.val();
      const activeChatIds = data ? Object.keys(data) : [];

      // Stop intervals for chats no longer in Firebase
      for (const [chatId, interval] of intervalIds) {
        if (!activeChatIds.includes(chatId)) {
          debug(`Chat ${chatId} removed from settime_groups, stopping interval`);
          await stopAutoSending(telegram, chatId);
        }
      }

      // Start intervals for active chats
      for (const chatId of activeChatIds) {
        if (!intervalIds.has(chatId)) {
          try {
            debug(`Fetching questions for chat ${chatId}`);
            const questions = await fetchQuestions();
            debug(`Starting auto-sending for chat ${chatId}`);
            await startAutoSending(telegram, chatId, questions);
          } catch (err) {
            debug(`Error starting auto-sending for chat ${chatId}:`, err);
            await telegram.sendMessage(chatId, 'Failed to resume auto-sending questions.');
          }
        } else {
          debug(`Auto-sending already active for chat ${chatId}`);
        }
      }
    }, { onlyOnce: false });
  } catch (err) {
    debug('Error loading settime groups:', err);
  }
};

// Initialize Firebase data at module level
loadSuperAdmins();
loadSetTimeGroups(telegram); // Note: telegram must be available here, or pass it when initializing

const quizes = () => async (ctx: Context) => {
  debug('Triggered "quizes" handler');

  if (!ctx.message || !('text' in ctx.message) || !ctx.chat) return;

  const text = ctx.message.text.trim().toLowerCase();
  const chapterMatch = text.match(/^\/chapter\s+(.+?)(?:\s+(\d+))?$/);
  const cmdMatch = text.match(/^\/(pyq(b|c|p)?|[bcp]1)(\s*\d+)?$/);
  const setTimeMatch = text.match(/^\/settime(?:\s+(\d+))?$/); // Updated to allow optional interval
  const stopTimeMatch = text.match(/^\/stoptime$/);

  // Function to create a Telegraph account
  const createTelegraphAccount = async () => {
    try {
      debug('Creating Telegraph account');
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

  // Function to get unique chapters
  const getUniqueChapters = (questions: Question[]) => {
    const chapters = new Set(questions.map((q: Question) => q.chapter?.trim()));
    return Array.from(chapters).filter(ch => ch).sort() as string[];
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
          })),
        },
        { tag: 'br' },
        { tag: 'p', children: ['To get questions from a chapter, use:'] },
        { tag: 'code', children: ['/chapter [name] [count]'] },
        { tag: 'br' },
        { tag: 'p', children: ['Example:'] },
        { tag: 'code', children: ['/chapter living world 2'] },
      ];

      debug('Creating Telegraph page');
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
        debug('Telegraph page created successfully');
        return data.result.url;
      } else {
        throw new Error(data.error);
      }
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

  // Handle /settime command
  if (setTimeMatch) {
    if (!await isAdmin(ctx)) {
      await ctx.reply('❌ You are not authorized to use this command.');
      return;
    }

    const chatId = ctx.chat.id.toString();
    if (intervalIds.has(chatId)) {
      await ctx.reply('⏰ Automatic question sending is already active in this chat.');
      return;
    }

    try {
      debug(`Setting up auto-sending for chat ${chatId}`);
      const questions = await fetchQuestions();
      if (!questions.length) {
        await ctx.reply('No questions available to send automatically.');
        return;
      }

      // Store in Firebase before starting interval
      await set(ref(db, `settime_groups/${chatId}`), true);
      await startAutoSending(ctx.telegram, chatId, questions);
      await ctx.reply('⏰ Started sending a random question every 30 minutes in this chat.');
    } catch (err) {
      debug('Error setting up automatic question sending:', err);
      await ctx.reply('Oops! Failed to set up automatic question sending.');
    }
    return;
  }

  // Handle /stoptime command
  if (stopTimeMatch) {
    if (!await isAdmin(ctx)) {
      await ctx.reply('❌ You are not authorized to use this command.');
      return;
    }

    const chatId = ctx.chat.id.toString();
    await stopAutoSending(ctx.telegram, chatId);
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
          question.options.D
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
          question.options.D
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

export { quizes };
