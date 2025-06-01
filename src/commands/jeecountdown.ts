import { Context } from 'telegraf';
import { createCanvas } from 'canvas';
import { differenceInDays, differenceInHours, differenceInMinutes, differenceInMonths } from 'date-fns';
import * as fs from 'fs/promises';
import * as path from 'path';

// Target date: May 3, 2025, 00:00:00 UTC
const TARGET_DATE = new Date('2025-05-03T00:00:00Z');

export function jeecountdown() {
  return async (ctx: Context) => {
    try {
      // Calculate time differences
      const now = new Date();
      const monthsLeft = differenceInMonths(TARGET_DATE, now);
      const daysLeft = differenceInDays(TARGET_DATE, now) % 30; // Approximate days
      const hoursLeft = differenceInHours(TARGET_DATE, now) % 24;
      const minutesLeft = differenceInMinutes(TARGET_DATE, now) % 60;

      // Create canvas
      const canvas = createCanvas(800, 400);
      const context = canvas.getContext('2d');

      // Background
      context.fillStyle = '#1a1a1a'; // Dark background
      context.fillRect(0, 0, canvas.width, canvas.height);

      // Title
      context.font = 'bold 40px Arial';
      context.fillStyle = '#ffffff';
      context.textAlign = 'center';
      context.fillText('JEE Countdown', canvas.width / 2, 80);

      // Months and Days
      context.font = 'bold 60px Arial';
      context.fillStyle = '#00ff00'; // Green for main text
      context.fillText(`${monthsLeft} months : ${daysLeft} days`, canvas.width / 2, 180);

      // Hours and Minutes (smaller font)
      context.font = 'bold 40px Arial';
      context.fillStyle = '#ffd700'; // Gold for secondary text
      context.fillText(`${hoursLeft} hours : ${minutesLeft} minutes`, canvas.width / 2, 260);

      // Save image to a temporary file in Vercel's /tmp directory
      const imagePath = path.join('/tmp', `jeecountdown-${Date.now()}.png`);
      const buffer = canvas.toBuffer('image/png');
      await fs.writeFile(imagePath, buffer);

      // Send image to user
      await ctx.replyWithPhoto({ source: imagePath }, {
        caption: `Time left until JEE (May 3, 2025):\n${monthsLeft} months, ${daysLeft} days, ${hoursLeft} hours, ${minutesLeft} minutes`,
      });

      // Clean up the temporary file
      await fs.unlink(imagePath);
    } catch (error) {
      console.error('Error generating JEE countdown image:', error);
      await ctx.reply('❌ Error: Unable to generate countdown image.');
    }
  };
}
