import { Context } from 'telegraf';
import { User } from 'telegraf/typings/core/types/typegram';
import { isPrivateChat } from '../utils/groupSettings';

interface UserInfo {
  id: number;
  name: string;
  username?: string;
  languageCode?: string;
}

export function setupInfoCommands() {
  return async (ctx: Context) => {
    try {
      if (!ctx.message || !('text' in ctx.message)) {
        return ctx.reply('Invalid command. Use /me, /info id <user_id>, or /info username <username>.');
      }

      const text = ctx.message.text;
      const args = text.split(' ').slice(1); // Get arguments after command
      const command = text.split(' ')[0].toLowerCase(); // Get command (/me or /info)

      if (command === '/me') {
        if (!ctx.from || !ctx.chat) {
          return ctx.reply('Could not identify your user information.');
        }
        const userInfo = await getUserInfo(ctx, ctx.from);
        return isPrivateChat(ctx.chat.type)
          ? sendPrivateUserInfo(ctx, userInfo)
          : sendGroupUserInfo(ctx, userInfo);
      }

      if (command === '/info' && args.length >= 2) {
        const type = args[0].toLowerCase();
        const query = args[1];

        let user: User | undefined;
        if (type === 'id') {
          // Fetch user by ID
          try {
            const chatMember = await ctx.telegram.getChatMember(ctx.chat!.id, parseInt(query));
            user = chatMember.user;
          } catch {
            return ctx.reply('User not found or invalid ID.');
          }
        } else if (type === 'username') {
          // Resolve username to user ID
          try {
            const chat = await ctx.telegram.getChat(query.startsWith('@') ? query : `@${query}`);
            if ('type' in chat && chat.type === 'private') {
              user = {
                id: chat.id,
                first_name: chat.first_name || '',
                last_name: chat.last_name,
                username: chat.username,
                is_bot: false,
                language_code: undefined,
              };
            }
          } catch {
            return ctx.reply('User not found or invalid username.');
          }
        } else {
          return ctx.reply('Invalid command. Use /info id <user_id> or /info username <username>.');
        }

        if (user) {
          const userInfo = await getUserInfo(ctx, user);
          return isPrivateChat(ctx.chat!.type)
            ? sendPrivateUserInfo(ctx, userInfo)
            : sendGroupUserInfo(ctx, userInfo);
        }
      }

      return ctx.reply('Usage: /me or /info id <user_id> or /info username <username>');
    } catch (error) {
      console.error('Error in info command:', error);
      await ctx.reply('An error occurred while processing your request.');
    }
  };
}

async function getUserInfo(ctx: Context, user: User): Promise<UserInfo> {
  return {
    id: user.id,
    name: `${user.first_name}${user.last_name ? ' ' + user.last_name : ''}`,
    username: user.username,
    languageCode: user.language_code ?? 'Unknown',
  };
}

async function sendPrivateUserInfo(ctx: Context, userInfo: UserInfo) {
  const profileLink = userInfo.username
    ? `[${userInfo.name}](tg://user?id=${userInfo.id})`
    : userInfo.name;

  const text = `
👤 *User Information* 👤

🆔 *ID:* \`${userInfo.id}\`
📛 *Name:* ${profileLink}
🔖 *Username:* ${userInfo.username ? '@' + userInfo.username : 'None'}
🌐 *Language:* ${userInfo.languageCode}

_This information is only visible to you._
  `;

  await ctx.reply(text, {
    parse_mode: 'Markdown',
  });
}

async function sendGroupUserInfo(ctx: Context, userInfo: UserInfo) {
  const profileLink = userInfo.username
    ? `<a href="tg://user?id=${userInfo.id}">${userInfo.name}</a>`
    : userInfo.name;

  const text = `
👤 User Information 👤

📛 Name: ${profileLink}
🔖 Username: ${userInfo.username ? '@' + userInfo.username : 'None'}
🌐 Language: ${userInfo.languageCode}
  `;

  await ctx.replyWithHTML(text, {
    reply_parameters: {
      message_id: ctx.message?.message_id!,
    },
  });
}
