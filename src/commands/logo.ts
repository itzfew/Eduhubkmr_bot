import { Context } from 'telegraf';
import { createCanvas, registerFont } from 'canvas';
import fs from 'fs';
import path from 'path';

const fontsDir = path.resolve(__dirname, '../assets/fonts');
const fontFamilies: string[] = [];

// Register fonts
fs.readdirSync(fontsDir).forEach((file) => {
  const filePath = path.join(fontsDir, file);
  if (fs.statSync(filePath).isFile() && /\.(ttf|otf)$/i.test(file)) {
    const familyName = path.parse(file).name.replace(/[-_\s]/g, '');
    try {
      registerFont(filePath, { family: familyName });
      fontFamilies.push(familyName);
    } catch (e) {
      console.warn(`❌ Font registration failed for ${file}:`, e);
    }
  }
});

function getRandomFont(): string {
  return fontFamilies.length > 0
    ? fontFamilies[Math.floor(Math.random() * fontFamilies.length)]
    : 'sans-serif';
}

function getRandomTextColor(): string {
  const colors = [
    '#facc15', '#34d399', '#60a5fa', '#f472b6', '#c084fc',
    '#f87171', '#fcd34d', '#38bdf8', '#4ade80', '#e879f9'
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

function splitText(text: string): [string, string] {
  const words = text.trim().split(/\s+/);
  let line1 = '', line2 = '';
  if (words.length === 1) {
    line1 = words[0];
  } else if (words.length === 2) {
    [line1, line2] = words;
  } else {
    line2 = words.pop()!;
    line1 = words.join(' ');
  }
  return [line1, line2];
}

async function generateLogo(text: string): Promise<{ buffer: Buffer, fontUsed: string }> {
  const width = 1000;
  const height = 400;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const fontFamily = getRandomFont();

  // Background
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, width, height);

  // Split text
  const [line1, line2] = splitText(text);

  // Auto-size font
  let fontSize = 100;
  do {
    ctx.font = `bold ${fontSize}px "${fontFamily}"`;
    fontSize -= 2;
  } while (
    Math.max(ctx.measureText(line1).width, ctx.measureText(line2).width) > width * 0.85 &&
    fontSize > 10
  );

  ctx.font = `bold ${fontSize}px "${fontFamily}"`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Gradient or solid fill
  if (Math.random() < 0.5) {
    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, getRandomTextColor());
    gradient.addColorStop(1, getRandomTextColor());
    ctx.fillStyle = gradient;
  } else {
    ctx.fillStyle = getRandomTextColor();
  }

  // Shadow
  ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
  ctx.shadowBlur = 25;
  ctx.shadowOffsetX = 6;
  ctx.shadowOffsetY = 6;

  // Rotation
  const angle = (Math.random() * 10 - 5) * (Math.PI / 180);
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate(angle);

  const lineHeight = fontSize + 20;
  if (line1) ctx.fillText(line1.toUpperCase(), 0, -lineHeight / 2);
  if (line2) ctx.fillText(line2.toUpperCase(), 0, lineHeight / 2);

  ctx.restore();

  return { buffer: canvas.toBuffer('image/png'), fontUsed: fontFamily };
}

// Telegraf Command
const logoCommand = () => async (ctx: Context) => {
  try {
    const message = ctx.message;
    const text = message?.text || '';
    const match = text.match(/^\/gen(?:logo)?\s+(.+)/i);

    if (!match) {
      return ctx.reply('❗ *Usage:* `/genlogo Your Text Here`', { parse_mode: 'Markdown' });
    }

    const logoText = match[1].trim();
    const { buffer, fontUsed } = await generateLogo(logoText);

    await ctx.replyWithPhoto({ source: buffer }, {
      caption: `🖼️ *Here's your custom logo!*\nFont: \`${fontUsed}\``,
      parse_mode: 'Markdown',
    });
  } catch (err) {
    console.error('⚠️ Logo generation error:', err);
    await ctx.reply('⚠️ Could not generate logo. Please try again.');
  }
};

export { logoCommand };
