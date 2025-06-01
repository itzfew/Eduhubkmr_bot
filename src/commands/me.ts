import { Context } from 'telegraf';
import { isPrivateChat } from '../utils/groupSettings';

function formatUserLink(id: number, name: string) {
  const encodedName = name.replace(//g, '\').replace(//g, '\');
  return `[${encodedName}](tg://user?id=${id})`;
}

interface BasicUserInfo {
  id: number;
  name: string;
  username?: string;
  languageCode?: string;
}

export function me() {
  return async (ctx: Context) => {
    try {
      const user = ctx.from;
      if (!user) return ctx.reply('Could not find your user data.');

      const userInfo: BasicUserInfo = {
        id: user.id,
        name: `${user.first_name}${user.last_name ? ' ' + user.last_name : ''}`,
        username: user.username,
        languageCode: user.language_code || 'Unknown',
      };

      const text = `
👤 *Your Info* 👤

🆔 *ID:* \`${userInfo.id}\`
📛 *Name:* ${formatUserLink(userInfo.id, userInfo.name)}
🔖 *Username:* ${userInfo.username ? '@' + userInfo.username : 'None'}
🌐 *Language:* ${userInfo.languageCode}
`;

      await ctx.reply(text, { parse_mode: 'Markdown' });
    } catch (err) {
      console.error('Error in /me:', err);
      await ctx.reply('An error occurred while fetching your info.');
    }
  };
}

export function info() {
  return async (ctx: Context) => {
    try {
      const query = ctx.message?.text?.split(' ').slice(1).join(' ').trim();
      if (!query) {
        return ctx.reply('Usage: /info <user_id or @username>');
      }

      let chat;
      try {
        chat = await ctx.telegram.getChat(query.startsWith('@') ? query : Number(query));
      } catch (error) {
        console.error('Error fetching chat:', error);
        return ctx.reply('⚠️ Could not retrieve user info. The user might not have interacted with the bot or doesn’t exist.');
      }

      const name = chat.first_name || chat.title || 'N/A';
      const text = `
👤 *User Info* 👤

🆔 *ID:* \`${chat.id}\`
📛 *Name:* ${formatUserLink(chat.id, name)}
🔖 *Username:* ${chat.username ? '@' + chat.username : 'None'}
🌐 *Type:* ${chat.type || 'private'}
`;

      await ctx.reply(text, { parse_mode: 'Markdown' });
    } catch (err) {
      console.error('Error in /info:', err);
      await ctx.reply('An error occurred while processing your request.');
    }
  };
}
