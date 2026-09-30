// Publishes a channel post with a "▶️ Учиться Go" button that opens the Mini App, then tries to pin it.
// Usage: node scripts/post-button.mjs -1001234567890
// The bot token is asked with hidden input and never written to disk or shell history.
// Only sendMessage / pinChatMessage are called: the bot's webhook and updates are not touched.

import { createInterface } from 'node:readline';

const BOT = 'gazeta_orbita_bot';
const LAUNCH_URL = `https://t.me/${BOT}?startapp`;
const TEXT = '🟢 Учиться Go — короткие задачи на доске 9×9.\nНажми кнопку, чтобы открыть приложение. Прогресс сохраняется.';

const chatId = process.argv[2];
if (!chatId || !/^-100\d+$/.test(chatId)) {
  console.error('Укажи ID канала вида -100…, например: node scripts/post-button.mjs -1001234567890');
  process.exit(1);
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => {
      if (s.startsWith(question)) process.stdout.write(question);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

const token = await askHidden('Токен бота (ввод скрыт): ');
if (!/^\d+:[\w-]{30,}$/.test(token)) {
  console.error('Это не похоже на токен бота.');
  process.exit(1);
}

async function call(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

const sent = await call('sendMessage', {
  chat_id: chatId,
  text: TEXT,
  reply_markup: { inline_keyboard: [[{ text: '▶️ Учиться Go', url: LAUNCH_URL }]] },
});
if (!sent.ok) {
  console.error(`Пост не отправлен: ${sent.description}`);
  process.exit(1);
}
console.log('Пост с кнопкой опубликован.');

const pinned = await call('pinChatMessage', { chat_id: chatId, message_id: sent.result.message_id, disable_notification: true });
console.log(pinned.ok ? 'Пост закреплён.' : `Закрепить не удалось (${pinned.description}) — закрепи пост вручную в канале.`);
