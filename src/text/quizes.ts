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

const quizes = () => async (ctx: Context) => {
  debug('Triggered "quizes" handler');

  if (!ctx.message || !('text' in ctx.message)) return;

  const text = ctx.message.text.trim().toLowerCase();
  const chapterMatch = text.match(/^\/chapter\s+(.+?)(?:\s+(\d+))?$/);
  const cmdMatch = text.match(/^\/(pyq(b|c|p)?|[bcp]1)(\s*\d+)?$/);

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

  // Function to fetch questions for a specific subject or all subjects
  const fetchQuestions = async (subject?: string): Promise<any[]> => {
    try {
      if (subject) {
        // Fetch questions for a specific subject
        const response = await fetch(JSON_FILES[subject]);
        if (!response.ok) {
          throw new Error(`Failed to fetch ${subject} questions: ${response.statusText}`);
        }
        return await response.json();
      } else {
        // Fetch questions from all subjects
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
          `Example: <code>/chapter living world 2</code>`,
        chapters,
      };
    } catch (err) {
      debug('Error generating chapters message:', err);
      throw err;
    }
  };

  // Handle /chapter command
  if (chapterMatch) {
    const chapterQuery = chapterMatch[1].trim();
    const count = chapterMatch[2] ? parseInt(chapterMatch[2], 10) : 1;

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
