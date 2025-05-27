import { Context } from 'telegraf';
import createDebug from 'debug';
import { distance } from 'fastest-levenshtein';

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

// Interface for quiz session (updated to include timerMessageId and timerIntervalId)
interface QuizSession {
  intervalId: NodeJS.Timeout; // For question sending
  questions: any[];
  currentIndex: number;
  ctx: Context;
  timerMessageId?: number; // Store the message ID of the timer message
  timerIntervalId?: NodeJS.Timeout; // Store the interval ID for the timer updates
}

// Store active quiz sessions by chat ID
const quizSessions: Map<number, QuizSession> = new Map();

// Function to calculate similarity score between two strings
const getSimilarityScore = (a: string, b: string): number => {
  const maxLength = Math.max(a.length, b.length);
  if (maxLength === 0) return 1.0;
  return (maxLength - distance(a, b)) / maxLength;
};

// Function to find best matching chapter using fuzzy search
const findBestMatchingChapter = (chapters: string[], query: string): string | null => {
  if (!query || !chapters.length) return null;
  
  // First try exact match (case insensitive)
  const exactMatch = chapters.find(ch => ch.toLowerCase() === query.toLowerCase());
  if (exactMatch) return exactMatch;

  // Then try contains match
  const containsMatch = chapters.find(ch => 
    ch.toLowerCase().includes(query.toLowerCase()) || 
    query.toLowerCase().includes(ch.toLowerCase())
  );
  if (containsMatch) return containsMatch;

  // Then try fuzzy matching
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  
  let bestMatch: string | null = null;
  let bestScore = 0.5; // Minimum threshold

  for (const chapter of chapters) {
    const chapterWords = chapter.toLowerCase().split(/\s+/);
    
    // Calculate word overlap score
    const matchingWords = queryWords.filter(qw => 
      chapterWords.some(cw => getSimilarityScore(qw, cw) > 0.7)
    );
    
    const overlapScore = matchingWords.length / Math.max(queryWords.length, 1);
    
    // Calculate full string similarity
    const fullSimilarity = getSimilarityScore(chapter.toLowerCase(), query.toLowerCase());
    
    // Combined score (weighted towards overlap)
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
        author_url: 'https://t.me/your_bot_username',
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

// Function to fetch questions for a specific subject or all subjects
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
        })),
      },
      { tag: 'br' },
      { tag: 'p', children: ['To get questions from a chapter, use:'] },
      { tag: 'code', children: ['/chapter [name] [count]'] },
      { tag: 'br' },
      { tag: 'p', children: ['Example:'] },
      { tag: 'code', children: ['/chapter living world 2'] },
      { tag: 'br' },
      { tag: 'p', children: ['To stop the quiz, use:'] },
      { tag: 'code', children: ['/stop'] },
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
        `Example: <code>/chapter living world 2</code>\n` +
        `To stop the quiz: <code>/stop</code>`,
      chapters,
    };
  } catch (err) {
    debug('Error generating chapters message:', err);
    throw err;
  }
};

// Function to send a single question (updated to include timer)
const sendQuestion = async (ctx: Context, question: any, session: QuizSession) => {
  const options = [
    question.options.A,
    question.options.B,
    question.options.C,
    question.options.D,
  ];
  const correctOptionIndex = ['A', 'B', 'C', 'D'].indexOf(question.correct_option);

  if (question.image) {
    try {
      await ctx.replyWithPhoto({ url: question.image });
      debug('Sent question image successfully');
    } catch (err) {
      debug('Error sending question image:', err.message, err.stack);
    }
  }

  // Send the quiz question
  try {
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
    debug('Sent quiz question successfully');
  } catch (err) {
    debug('Error sending quiz question:', err.message, err.stack);
    throw err; // Rethrow to stop the quiz if the question fails
  }

  // Start the countdown timer
  try {
    const chatId = ctx.chat?.id;
    if (!chatId) throw new Error('No chatId found');

    let timeLeft = 30; // Match the 30-second question interval
    const timerMessage = await ctx.reply(`⏳ Time left: ${timeLeft}s`);
    session.timerMessageId = timerMessage.message_id;
    debug('Sent initial timer message, message_id:', timerMessage.message_id);

    // Start updating the timer every second
    session.timerIntervalId = setInterval(async () => {
      timeLeft--;
      if (timeLeft < 0) {
        clearInterval(session.timerIntervalId!);
        session.timerIntervalId = undefined;
        debug('Timer stopped for message_id:', session.timerMessageId);
        return;
      }

      try {
        await ctx.telegram.editMessageText(
          chatId,
          session.timerMessageId!,
          undefined,
          `⏳ Time left: ${timeLeft}s`
        );
        debug(`Updated timer to ${timeLeft}s, message_id:`, session.timerMessageId);
      } catch (err) {
        debug('Error updating timer message:', err.message, err.stack);
        clearInterval(session.timerIntervalId!);
        session.timerIntervalId = undefined;
      }
    }, 1000); // Update every second
  } catch (err) {
    debug('Error starting timer:', err.message, err.stack);
    await ctx.reply('⚠️ Failed to start timer, continuing with quiz...');
  }
};

// Function to start a quiz session (updated to handle timer)
const startQuizSession = (ctx: Context, questions: any[], count: number) => {
  const chatId = ctx.chat?.id;
  if (!chatId) {
    ctx.reply('Error: Unable to start quiz session.');
    debug('No chatId found in ctx');
    return;
  }

  // Stop any existing session
  stopQuizSession(chatId);

  // Shuffle and limit questions
  const shuffled = questions.sort(() => 0.5 - Math.random());
  const selected = shuffled.slice(0, Math.min(count, questions.length));

  if (!selected.length) {
    ctx.reply('No questions available.');
    debug('No questions available after filtering');
    return;
  }

  // Initialize session
  const session: QuizSession = {
    intervalId: null as any, // Will be set below
    questions: selected,
    currentIndex: 0,
    ctx,
    timerMessageId: undefined, // Initialize as undefined
    timerIntervalId: undefined, // Initialize as undefined
  };

  // Send first question immediately
  sendQuestion(ctx, session.questions[session.currentIndex], session).catch(err => {
    debug('Error sending first question:', err.message, err.stack);
    ctx.reply('Oops! Failed to send a question.');
    stopQuizSession(chatId);
  });
  session.currentIndex++;

  // Start interval for remaining questions
  session.intervalId = setInterval(async () => {
    if (session.currentIndex >= session.questions.length) {
      // Stop and delete the last timer
      if (session.timerIntervalId) {
        clearInterval(session.timerIntervalId);
        session.timerIntervalId = undefined;
        debug('Stopped final timer interval');
      }
      if (session.timerMessageId) {
        try {
          await ctx.telegram.deleteMessage(chatId, session.timerMessageId);
          debug('Deleted final timer message, message_id:', session.timerMessageId);
        } catch (err) {
          debug('Error deleting final timer message:', err.message, err.stack);
        }
      }
      await ctx.reply('✅ Quiz completed! No more questions available.\nUse /chapter or /pyq to start another quiz.');
      stopQuizSession(chatId);
      return;
    }

    // Stop and delete the previous timer
    if (session.timerIntervalId) {
      clearInterval(session.timerIntervalId);
      session.timerIntervalId = undefined;
      debug('Stopped previous timer interval');
    }
    if (session.timerMessageId) {
      try {
        await ctx.telegram.deleteMessage(chatId, session.timerMessageId);
        debug('Deleted previous timer message, message_id:', session.timerMessageId);
      } catch (err) {
        debug('Error deleting previous timer message:', err.message, err.stack);
      }
    }

    try {
      await sendQuestion(ctx, session.questions[session.currentIndex], session);
      session.currentIndex++;
    } catch (err) {
      debug('Error sending question:', err.message, err.stack);
      // Stop and delete the timer if it exists
      if (session.timerIntervalId) {
        clearInterval(session.timerIntervalId);
        session.timerIntervalId = undefined;
        debug('Stopped timer interval after question error');
      }
      if (session.timerMessageId) {
        try {
          await ctx.telegram.deleteMessage(chatId, session.timerMessageId);
          debug('Deleted timer message after question error, message_id:', session.timerMessageId);
        } catch (err) {
          debug('Error deleting timer message after question error:', err.message, err.stack);
        }
      }
      await ctx.reply('Oops! Failed to send a question.');
      stopQuizSession(chatId);
    }
  }, 30000); // 30 seconds

  // Store session
  quizSessions.set(chatId, session);
  ctx.reply('🚀 Quiz started! A new question will be sent every 30 seconds. Use /stop to end the quiz.');
  debug('Quiz session started for chatId:', chatId);
};

// Function to stop a quiz session (updated to handle timer)
const stopQuizSession = (chatId: number) => {
  const session = quizSessions.get(chatId);
  if (session) {
    clearInterval(session.intervalId);
    // Stop and delete the timer
    if (session.timerIntervalId) {
      clearInterval(session.timerIntervalId);
      session.timerIntervalId = undefined;
      debug('Stopped timer interval on quiz stop');
    }
    if (session.timerMessageId) {
      try {
        session.ctx.telegram.deleteMessage(chatId, session.timerMessageId);
        debug('Deleted timer message on quiz stop, message_id:', session.timerMessageId);
      } catch (err) {
        debug('Error deleting timer message on quiz stop:', err.message, err.stack);
      }
    }
    quizSessions.delete(chatId);
    session.ctx.reply('🛑 Quiz stopped.');
    debug('Quiz session stopped for chatId:', chatId);
  }
};

// Main quizes handler
const quizes = () => async (ctx: Context) => {
  debug('Triggered "quizes" handler');

  if (!ctx.message || !('text' in ctx.message)) return;

  const text = ctx.message.text.trim().toLowerCase();
  const chapterMatch = text.match(/^\/chapter\s+(.+?)(?:\s+(\d+))?$/);
  const cmdMatch = text.match(/^\/(pyq(b|c|p)?|[bcp]1)(\s*\d+)?$/);
  const stopMatch = text.match(/^\/stop$/);

  const chatId = ctx.chat?.id;
  if (!chatId) return;

  // Handle /stop command
  if (stopMatch) {
    if (quizSessions.has(chatId)) {
      stopQuizSession(chatId);
    } else {
      await ctx.reply('No active quiz session to stop.');
    }
    return;
  }

  // Handle /chapter command
  if (chapterMatch) {
    const chapterQuery = chapterMatch[1].trim();
    const count = chapterMatch[2] ? parseInt(chapterMatch[2], 10) : 10; // Default to 10 questions

    try {
      const allQuestions = await fetchQuestions();
      const chapters = getUniqueChapters(allQuestions);
      
      // Find the best matching chapter using fuzzy search
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

      // If the matched chapter isn't an exact match, confirm with user
      if (matchedChapter.toLowerCase() !== chapterQuery.toLowerCase()) {
        await ctx.replyWithHTML(
          `🔍 Did you mean "<b>${matchedChapter}</b>"?\n\n` +
          `Starting quiz with questions from this chapter...\n` +
          `(If this isn't correct, use /stop and try again with a more specific chapter name)`
        );
      }

      startQuizSession(ctx, filteredByChapter, count);
    } catch (err) {
      debug('Error fetching questions:', err.message, err.stack);
      await ctx.reply('Oops! Failed to load questions.');
    }
    return;
  }

  // Handle /pyq, /b1, /c1, /p1 commands
  if (cmdMatch) {
    const cmd = cmdMatch[1]; // pyq, pyqb, pyqc, pyqp, b1, c1, p1
    const subjectCode = cmdMatch[2]; // b, c, p
    const count = cmdMatch[3] ? parseInt(cmdMatch[3].trim(), 10) : 10; // Default to 10 questions

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

      startQuizSession(ctx, filtered, count);
    } catch (err) {
      debug('Error fetching questions:', err.message, err.stack);
      await ctx.reply('Oops! Failed to load questions.');
    }
  }
};

// Export stop handler for external use (e.g., in main bot file)
export const stopQuiz = () => async (ctx: Context) => {
  const chatId = ctx.chat?.id;
  if (chatId && quizSessions.has(chatId)) {
    stopQuizSession(chatId);
  } else {
    await ctx.reply('No active quiz session to stop.');
  }
};

export { quizes };
