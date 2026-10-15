/**
 * One line to Koa about a Grove order: Telegram first, the mail relay second.
 *
 * Telegram is where the farm bots already talk, but TELEGRAM_KOA_CHAT_ID is a
 * new secret and may not be bound yet; sendTelegramMessage returns false (not
 * an error) when it is not, and then the line goes by email so it is never
 * dropped on the floor. Returns which transport carried it, or 'none'.
 */
import { sendTelegramMessage } from './telegram.js';
import { sendEmail } from './mailer.js';

export const DESK_GROVE_URL = 'https://rogueff.github.io/rogue-origin-apps/src/pages/tag-desk.html?view=grove';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function notifyKoa(env, text, { link = DESK_GROVE_URL } = {}) {
  const chatId = env.TELEGRAM_KOA_CHAT_ID || env.TELEGRAM_CHAT_ID || env.TELEGRAM_TEST_CHAT_ID;
  const html = `${esc(text)}${link ? `\n<a href="${esc(link)}">Desk · Grove</a>` : ''}`;
  try {
    if (await sendTelegramMessage(env, { chatId, text: html, parseMode: 'HTML' })) return 'telegram';
  } catch (e) {
    console.error('[grove][notify] telegram failed, trying email', e);
  }
  const to = env.KOA_EMAIL || env.REORDER_CC;
  if (to) {
    try {
      await sendEmail(env, { to, subject: text.split('\n')[0].slice(0, 120), text: `${text}${link ? `\n\n${link}` : ''}` });
      return 'email';
    } catch (e) {
      console.error('[grove][notify] email failed', e);
    }
  }
  console.log(`[grove][notify] no transport — would say:\n${text}`);
  return 'none';
}
