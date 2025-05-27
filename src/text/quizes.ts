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

// Interface for quiz session
interface QuizSession {
  questionIntervalId: NodeJS.Timeout;
  timerIntervalId: NodeJS.Timeout | null;
  timerMessageId: number | null;
  questions: any[];
  currentIndex: number;
  ctx: Context;
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

// Function to send a single question
const sendQuestion = async (ctx: Context, question: any) => {
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
};

// Function to start or update the countdown timer
const startTimer = async (session: QuizSession) => {
  const ctx = session.ctx;
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  let secondsLeft = 30;

  // If a timer message exists, delete it
  if (session.timerMessageId) {
    try {
      await ctx.telegram.deleteMessage(chatId, session.timerMessageId);
    } catch (err) {
      debug('Error deleting previous timer message:', err);
    }
  }

  // Clear any existing timer interval
  if (session.timerIntervalId) {
    clearInterval(session.timerIntervalId);
  }

  // Send initial timer message
  const timerMessage = await ctx.reply(`⏳ Next question in ${secondsLeft}s`);
  session.timerMessageId = timerMessage.message_id;

  // Start countdown
  session.timerIntervalId = setInterval(async () => {
    secondsLeft--;
    if (secondsLeft <= 0) {
      // Stop timer without clearing session.timerIntervalId here (handled elsewhere)
      try {
        await ctx.telegram.editMessageText(
          chatId,
          session.timerMessageId!,
          undefined,
          '⏳ Sending next question...'
        );
      } catch (err) {
        debug('Error updating timer message:', err);
      }
      return;
    }

    try {
      await ctx.telegram.editMessageText(
        chatId,
        session.timerMessageId!,
        undefined,
        `⏳ Next question in ${secondsLeft}s`
      );
    } catch (err) {
      debug('Error updating timer message:', err);
      // Stop timer if editing fails (e.g., message deleted)
      clearInterval(session.timerIntervalId!);
      session.timerIntervalId = null;
      session.timerMessageId = null;
    }
  }, 1000); // Update every second
};

// Function to stop the timer
const stopTimer = async (session: QuizSession) => {
  if (session.timerIntervalId) {
    clearInterval(session.timerIntervalId);
    session.timerIntervalId = null;
  }
  if (session.timerMessageId && session.ctx.chat?.id) {
    try {
      await session.ctx.telegram.deleteMessage(session.ctx.chat.id, session.timerMessageId);
    } catch (err) {
      debug('Error deleting timer message:', err);
    }
    session.timerMessageId = null;
  }
};

// Function to start a quiz session
const startQuizSession = async (ctx: Context, questions: any[], count: number) => {
  const chatId = ctx.chat?.id;
  if (!chatId) {
    await ctx.reply('Error: Unable to start quiz session.');
    return;
  }

  // Stop any existing session
  stopQuizSession(chatId);

  // Shuffle and limit questions
  const shuffled = questions.sort(() => 0.5 - Math.random());
  const selected = shuffled.slice(0, Math.min(count, questions.length));

  if (!selected.length) {
    await ctx.reply('No questions available.');
    return;
  }

  // Initialize session
  const session: QuizSession = {
    questionIntervalId: null as any,
    timerIntervalId: null,
    timerMessageId: null,
    questions: selected,
    currentIndex: 0,
    ctx,
  };

  // Send first question immediately
  try {
    await sendQuestion(ctx, session.questions[session.currentIndex]);
    session.currentIndex++;
  } catch (err) {
    debug('Error sending question:', err);
    await ctx.reply('Oops! Failed to send a question.');
    stopQuizSession(chatId);
    return;
  }

  // Start timer for next question
  if (session.currentIndex < session.questions.length) {
    await startTimer(session);
  }

  // Start interval for remaining questions
  session.questionIntervalId = setInterval(async () => {
    if (session.currentIndex >= session.questions.length) {
      await stopTimer(session);
      await ctx.reply('✅ Quiz completed! No more questions available.\nUse /chapter or /pyq to start another quiz.');
      stopQuizSession(chatId);
      return;
    }

    try {
      await sendQuestion(ctx, session.questions[session.currentIndex]);
      session.currentIndex++;
      if (session.currentIndex < session.questions.length) {
        await startTimer(session);
      } else {
        await stopTimer(session);
      }
    } catch (err) {
      debug('Error sending question:', err);
      await stopTimer(session);
      await ctx.reply('Oops! Failed to send a question.');
      stopQuizSession(chatId);
    }
  }, 30000); // 30 seconds

  // Store session
  quizSessions.set(chatId, session);
  await ctx.reply('🚀 Quiz started! A new question will be sent every 30 seconds. Use /stop to end the quiz.');
};

// Function to stop a quiz session
const stopQuizSession = async (chatId: number) => {
  const session = quizSessions.get(chatId);
  if (session) {
    clearInterval(session.questionIntervalId);
    await stopTimer(session);
    quizSessions.delete(chatId);
    await session.ctx.reply('🛑 Quiz stopped.');
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
      await stopQuizSession(chatId);
    } else {
      await ctx.reply('No active quiz session to stop.');
    }
    return;
  }

  // Handle /chapter command
  if (chapterMatch) {
    const chapterQuery = chapterMatch[1].trim();
    const count = chapterMatch[2] ? parseInt(chapterMatch[2], 10) : 10;

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
          `Starting quiz with questions from this chapter...\n` +
          `(If this isn't correct, use /stop and try again with a more specific chapter name)`
        );
      }

      startQuizSession(ctx, filteredByChapter, count);
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
    const count = cmdMatch[3] ? parseInt(cmdMatch[3].trim(), 10) : 10;

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
      debug('Error fetching questions:', err);
      await ctx.reply('Oops! Failed to load questions.');
    }
  }
};

// Export stop handler for external use
export const stopQuiz = () => async (ctx: Context) => {
  const chatId = ctx.chat?.id;
  if (chatId && quizSessions.has(chatId)) {
    await stopQuizSession(chatId);
  } else {
    await ctx.reply('No active quiz session to stop.');
  }
};

export { quizes };
