import createDebug from 'debug';

const debug = createDebug('bot:questionUtils');

const BASE_URL = 'https://raw.githubusercontent.com/itzfew/Eduhub-KMR/refs/heads/main/';
const JSON_FILES: Record<string, string> = {
  biology: `${BASE_URL}biology.json`,
  chemistry: `${BASE_URL}chemistry.json`,
  physics: `${BASE_URL}physics.json`,
};

export async function fetchQuestions(subject?: string): Promise<any[]> {
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
}
