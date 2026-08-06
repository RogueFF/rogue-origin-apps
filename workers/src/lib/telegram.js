/**
 * Telegram sender — shared by any handler that wants to push a notification
 * (as opposed to the two existing cron-only inline sends in index.js).
 * Falls back to console.log when creds are unset, matching the existing
 * cron behavior, so a missing secret never breaks the caller.
 */

/**
 * @param {object} env - Worker env bindings
 * @param {object} opts
 * @param {string} opts.chatId - Telegram chat id to send to
 * @param {string} opts.text - Message body
 * @param {string} [opts.parseMode] - 'Markdown' | 'HTML' | undefined
 * @returns {Promise<void>}
 */
export async function sendTelegramMessage(env, { chatId, text, parseMode = 'Markdown' } = {}) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) {
    console.log(`[telegram] token/chatId not configured — message would be:\n${text}`);
    return;
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: parseMode,
      disable_web_page_preview: true,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Telegram API error ${res.status}: ${err.slice(0, 200)}`);
  }
}
