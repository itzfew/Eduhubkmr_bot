import { Context } from 'telegraf';
import { db, ref, set, onValue, remove, off } from '../utils/firebase';

// Target NEET exam date
const NEET_DATE = new Date('2026-05-03T00:00:00+05:30'); // IST timezone

// Function to calculate countdown in months:days:hours
const getCountdown = (): string => {
  const now = new Date();
  const diffMs = NEET_DATE.getTime() - now.getTime();

  if (diffMs <= 0) {
    return 'NEET 2026 has passed! 🎉';
  }

  const msInHour = 1000 * 60 * 60;
  const msInDay = msInHour * 24;
  const msInMonth = msInDay * 30.42; // Average days in a month (365/12)

  const months = Math.floor(diffMs / msInMonth);
  const remainingAfterMonths = diffMs % msInMonth;
  const days = Math.floor(remainingAfterMonths / msInDay);
  const remainingAfterDays = remainingAfterMonths % msInDay;
  const hours = Math.floor(remainingAfterDays / msInHour);

  return `${months} months:${days} days:${hours} hours`;
};

// Function to generate a well-designed countdown message
const generateCountdownMessage = (): string => {
  const countdown = getCountdown();
  return (
    `📅 *NEET 2026 Countdown* 📅\n\n` +
    `⏰ *${countdown}* until *May 3, 2026*! ⏰\n` +
    `🚀 *Gear up for NEET! Stay focused and keep studying!* 🚀\n` +
    `🔥 *Every moment counts—make it happen!* 🔥\n` +
    `_Updated daily!_`
  );
};

// Function to check admin status
const isAdmin = async (ctx: Context, userId: number, chatId: number): Promise<boolean> => {
  try {
    if (ctx.chat?.type === 'private') return true; // Allow in private chats
    const admins = await ctx.telegram.getChatAdministrators(chatId);
    return admins.some((admin) => admin.user.id === userId);
  } catch (error) {
    console.error('Error checking admin status:', error);
    return false;
  }
};

// Function to save/update pinned message in Firebase
const savePinnedMessage = async (chatId: number, messageId: number): Promise<void> => {
  try {
    const pinnedRef = ref(db, `pinnedMessages/${chatId}`);
    await set(pinnedRef, { messageId, lastUpdated: Date.now() });
  } catch (error) {
    console.error('Error saving pinned message to Firebase:', error);
    throw error;
  }
};

// Function to get pinned message from Firebase
const getPinnedMessage = async (chatId: number): Promise<{ messageId: number; lastUpdated: number } | null> => {
  try {
    const pinnedRef = ref(db, `pinnedMessages/${chatId}`);
    const snapshot = await new Promise((resolve) => {
      onValue(pinnedRef, resolve, { onlyOnce: true });
    });
    return (snapshot as any).val();
  } catch (error) {
    console.error('Error retrieving pinned message from Firebase:', error);
    return null;
  }
};

// Function to update pinned message
const updatePinnedMessage = async (ctx: Context, chatId: number, messageId: number): Promise<void> => {
  try {
    await ctx.telegram.editMessageText(
      chatId,
      messageId,
      undefined,
      generateCountdownMessage(),
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '🔄 Refresh Countdown', callback_data: `refresh_countdown_${chatId}_${messageId}` }]],
        },
      }
    );
    await savePinnedMessage(chatId, messageId); // Update lastUpdated timestamp
  } catch (error) {
    console.error(`Error updating pinned message for chat ${chatId}, message ${messageId}:`, error);
    throw error;
  }
};

// Command handler for /neetcountdown
export const pin = () => async (ctx: Context) => {
  const chatId = ctx.chat?.id;
  const userId = ctx.from?.id;

  if (!chatId || !userId) {
    await ctx.reply('❌ Error: Unable to process command.');
    return;
  }

  // Check if user is admin in group chats or allow in private chats
  const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
  if (isGroup && !(await isAdmin(ctx, userId, chatId))) {
    await ctx.reply('🚫 Only group admins can use this command.');
    return;
  }

  // Check if a countdown is already active
  const pinnedData = await getPinnedMessage(chatId);
  if (pinnedData && pinnedData.messageId) {
    await ctx.reply('⚠️ A countdown is already active in this chat. Use /stopcountdown to stop it first.');
    return;
  }

  try {
    // Send the initial countdown message
    const sentMessage = await ctx.reply(generateCountdownMessage(), {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{ text: '🔄 Refresh Countdown', callback_data: `refresh_countdown_${chatId}_${sentMessage.message_id}` }]],
      },
    });

    const messageId = sentMessage.message_id;

    // Pin the message
    await ctx.telegram.pinChatMessage(chatId, messageId, { disable_notification: true });
    await savePinnedMessage(chatId, messageId);
    await ctx.reply('✅ NEET countdown started and pinned!');
  } catch (error) {
    console.error('Error setting up countdown:', error);
    await ctx.reply('❌ Failed to set up the countdown.');
  }
};

// Command to stop the countdown
export const stopCountdown = () => async (ctx: Context) => {
  const chatId = ctx.chat?.id;
  const userId = ctx.from?.id;

  if (!chatId || !userId) {
    await ctx.reply('❌ Error: Unable to process command.');
    return;
  }

  // Check if user is admin in group chats
  const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
  if (isGroup && !(await isAdmin(ctx, userId, chatId))) {
    await ctx.reply('🚫 Only group admins can use this command.');
    return;
  }

  try {
    const pinnedData = await getPinnedMessage(chatId);
    if (!pinnedData || !pinnedData.messageId) {
      await ctx.reply('⚠️ No active countdown found in this chat.');
      return;
    }

    // Remove pinned message data from Firebase and unpin
    const pinnedRef = ref(db, `pinnedMessages/${chatId}`);
    await remove(pinnedRef);
    await ctx.telegram.unpinChatMessage(chatId, { message_id: pinnedData.messageId });
    await ctx.reply('✅ NEET countdown stopped and unpinned.');
  } catch (error) {
    console.error('Error stopping countdown:', error);
    await ctx.reply('❌ Failed to stop the countdown.');
  }
};

// Set up daily update listener and callback query handler
export const setupDailyUpdateListener = (bot: any) => {
  // Handle callback queries for refresh
  bot.on('callback_query', async (callbackCtx: Context) => {
    const chatId = callbackCtx.chat?.id;
    const messageId = callbackCtx.callbackQuery?.message?.message_id;
    const callbackData = callbackCtx.callbackQuery?.data;

    if (!chatId || !messageId || !callbackData) {
      await callbackCtx.answerCbQuery('❌ Error: Invalid context.');
      return;
    }

    if (callbackData.startsWith('refresh_countdown_')) {
      try {
        // Validate that the message is still pinned
        const pinnedData = await getPinnedMessage(chatId);
        if (!pinnedData || pinnedData.messageId !== messageId) {
          await callbackCtx.answerCbQuery('❌ Error: Countdown message is no longer active.');
          return;
        }

        await updatePinnedMessage(callbackCtx, chatId, messageId);
        await callbackCtx.answerCbQuery('✅ Countdown refreshed!');
      } catch (error) {
        console.error('Error refreshing countdown:', error);
        await callbackCtx.answerCbQuery('❌ Failed to refresh countdown.');
      }
    }
  });

  // Set up Firebase listener for daily updates
  const pinnedMessagesRef = ref(db, 'pinnedMessages');
  onValue(pinnedMessagesRef, async (snapshot) => {
    const data = snapshot.val();
    if (!data) return;

    for (const chatId of Object.keys(data)) {
      const { messageId, lastUpdated } = data[chatId];
      if (!messageId || !lastUpdated) continue;

      const now = Date.now();
      const oneDayMs = 24 * 60 * 60 * 1000;

      if (now - lastUpdated >= oneDayMs) {
        try {
          // Create a mock context for Telegram API calls
          const ctx = {
            telegram: bot.telegram,
            chat: { id: parseInt(chatId) },
          } as Context;
          await updatePinnedMessage(ctx, parseInt(chatId), messageId);
        } catch (error) {
          console.error(`Error updating countdown for chat ${chatId}:`, error);
        }
      }
    }
  });
};

// Cleanup function to remove listeners
export const cleanupListeners = () => {
  const pinnedMessagesRef = ref(db, 'pinnedMessages');
  off(pinnedMessagesRef);
};
