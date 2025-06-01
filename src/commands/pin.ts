import { Context } from 'telegraf';
import { db, ref, set, onValue, remove } from '../utils/firebase';
import { formatDistanceToNow, isValid } from 'date-fns';

// Target NEET exam date
const NEET_DATE = new Date('2026-05-03T00:00:00+05:30'); // IST timezone

// Function to calculate countdown
const getCountdown = () => {
  if (!isValid(NEET_DATE)) {
    return 'Invalid target date for NEET 2026.';
  }
  const now = new Date();
  const distance = formatDistanceToNow(NEET_DATE, { addSuffix: false });
  return distance;
};

// Function to generate a well-designed countdown message
const generateCountdownMessage = () => {
  const countdown = getCountdown();
  return (
    `📅 *NEET 2026 Countdown* 📅\n\n` +
    `⏰ *${countdown}* to go until *May 3, 2026*! ⏰\n` +
    `Get ready to ace your NEET exam! 🚀\n` +
    `🔥 *Study hard, stay focused, and make every day count!* 🔥\n` +
    `_This message updates daily!_`
  );
};

// Function to check admin status
const isAdmin = async (ctx: Context, userId: number, chatId: number) => {
  try {
    const admins = await ctx.telegram.getChatAdministrators(chatId);
    return admins.some((admin) => admin.user.id === userId);
  } catch (error) {
    console.error('Error checking admin status:', error);
    return false;
  }
};

// Function to save/update pinned message in Firebase
const savePinnedMessage = async (chatId: number, messageId: number) => {
  try {
    const pinnedRef = ref(db, `pinnedMessages/${chatId}`);
    await set(pinnedRef, { messageId, lastUpdated: Date.now() });
  } catch (error) {
    console.error('Error saving pinned message to Firebase:', error);
  }
};

// Function to update pinned message
const updatePinnedMessage = async (ctx: Context, chatId: number, messageId: number) => {
  try {
    await ctx.telegram.editMessageText(
      chatId,
      messageId,
      undefined,
      generateCountdownMessage(),
      { parse_mode: 'Markdown' }
    );
    await savePinnedMessage(chatId, messageId); // Update lastUpdated timestamp
  } catch (error) {
    console.error('Error updating pinned message:', error);
  }
};

// Command handler for /neetcountdown
export const pin = () => async (ctx: Context) => {
  const chatId = ctx.chat?.id;
  const userId = ctx.from?.id;

  if (!chatId || !userId) {
    return ctx.reply('Error: Unable to process command.');
  }

  // Check if user is admin in group chats or allow in private chats
  const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
  if (isGroup && !(await isAdmin(ctx, userId, chatId))) {
    return ctx.reply('Only group admins can use this command.');
  }

  // Send the initial countdown message
  const sentMessage = await ctx.reply(generateCountdownMessage(), {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [[{ text: 'Refresh Countdown', callback_data: 'refresh_countdown' }]],
    },
  });

  const messageId = sentMessage.message_id;

  // Pin the message
  try {
    await ctx.telegram.pinChatMessage(chatId, messageId, { disable_notification: true });
  } catch (error) {
    console.error('Error pinning message:', error);
    await ctx.reply('Failed to pin the countdown message.');
    return;
  }

  // Save pinned message details to Firebase
  await savePinnedMessage(chatId, messageId);

  // Set up Firebase listener for daily updates
  const pinnedRef = ref(db, `pinnedMessages/${chatId}`);
  onValue(pinnedRef, async (snapshot) => {
    const data = snapshot.val();
    if (data && data.messageId) {
      const lastUpdated = data.lastUpdated || 0;
      const now = Date.now();
      const oneDayMs = 24 * 60 * 60 * 1000; // One day in milliseconds

      // Check if a day has passed since the last update
      if (now - lastUpdated >= oneDayMs) {
        await updatePinnedMessage(ctx, chatId, data.messageId);
      }
    }
  });

  // Handle refresh button
  ctx.telegram.on('callback_query', async (callbackCtx) => {
    if (callbackCtx.callbackQuery?.data === 'refresh_countdown') {
      if (callbackCtx.chat?.id !== chatId) {
        await callbackCtx.answerCbQuery('Unauthorized');
        return;
      }

      try {
        await updatePinnedMessage(callbackCtx, chatId, messageId);
        await callbackCtx.answerCbQuery('Countdown refreshed!');
      } catch (error) {
        console.error('Error refreshing countdown:', error);
        await callbackCtx.answerCbQuery('Failed to refresh countdown.');
      }
    }
  });
};

// Command to stop the countdown
export const stopCountdown = () => async (ctx: Context) => {
  const chatId = ctx.chat?.id;
  const userId = ctx.from?.id;

  if (!chatId || !userId) {
    return ctx.reply('Error: Unable to process command.');
  }

  // Check if user is admin in group chats
  const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
  if (isGroup && !(await isAdmin(ctx, userId, chatId))) {
    return ctx.reply('Only group admins can use this command.');
  }

  // Remove pinned message data from Firebase
  try {
    const pinnedRef = ref(db, `pinnedMessages/${chatId}`);
    await remove(pinnedRef);
    await ctx.reply('NEET countdown stopped and unpinned.');
    await ctx.telegram.unpinChatMessage(chatId);
  } catch (error) {
    console.error('Error stopping countdown:', error);
    await ctx.reply('Failed to stop the countdown.');
  }
};
