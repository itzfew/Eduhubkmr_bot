import { Context } from 'telegraf';
import { isPrivateChat } from '../utils/groupSettings';

function formatUserLink(id: number, name: string) {
  const encodedName = name.replace(//g, '(').replace(//g, ')');
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

      let userId: number | undefined;
      let username: string | undefined;

      if (/^@?\w{5,32}$/.test(query)) {
        username = query.replace('@', '');
      } else if (/^\d{6,15}$/.test(query)) {
        userId = parseInt(query);
      } else {
        return ctx.reply('Invalid ID or username.');
      }

      let user;
      try {
        if (username) {
          user = await ctx.telegram.getChat(`@${username}`);
        } else if (userId) {
          user = await ctx.telegram.getChat(userId);
        }
      } catch (error) {
        console.error('Error fetching user:', error);
        return ctx.reply('Could not retrieve user info. The bot may not have access.');
      }

      const name = user.first_name + (user.last_name ? ' ' + user.last_name : '');

      const text = `
👤 *User Info* 👤

🆔 *ID:* \`${user.id}\`
📛 *Name:* ${formatUserLink(user.id, name)}
🔖 *Username:* ${user.username ? '@' + user.username : 'None'}
🌐 *Language:* ${user.language_code || 'Unknown'}
`;

      await ctx.reply(text, { parse_mode: 'Markdown' });
    } catch (err) {
      console.error('Error in /info:', err);
      await ctx.reply('An error occurred while processing your request.');
    }
  };
}
