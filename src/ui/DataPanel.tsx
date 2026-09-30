import { useState } from 'preact/hooks';
import { PROBLEM_IDS, TOPIC_IDS, solvedCount } from '../course';
import { type Progress, parseProgress } from '../progress';

interface Props {
  progress: Progress;
  onReplace: (p: Progress) => void;
  onReset: () => void;
}

type Mode = null | 'export' | 'import' | 'reset';

export function DataPanel({ progress, onReplace, onReset }: Props) {
  const [mode, setMode] = useState<Mode>(null);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const exported = JSON.stringify(progress);

  const toggle = (m: Mode) => {
    setMode(mode === m ? null : m);
    setMsg(null);
    setText('');
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(exported);
      setMsg('Скопировано. Сохрани текст в заметках или отправь себе в «Избранное».');
    } catch {
      setMsg('Не удалось скопировать автоматически — выдели текст и скопируй вручную.');
    }
  };

  const doImport = () => {
    const p = parseProgress(text.trim(), PROBLEM_IDS, TOPIC_IDS);
    if (!p) {
      setMsg('Не получилось прочитать данные. Проверь, что вставлен весь текст экспорта.');
      return;
    }
    onReplace({ ...p, updatedAt: Date.now() });
    setMsg(`Прогресс загружен: решено ${solvedCount(p)} задач.`);
    setText('');
  };

  return (
    <section class="card data">
      <h2>Мой прогресс</h2>
      <p class="muted small">Прогресс хранится на этом устройстве{' '}и в облаке Telegram, если приложение открыто из Telegram.</p>
      <div class="data-buttons">
        <button class="secondary" aria-pressed={mode === 'export'} onClick={() => toggle('export')}>
          Экспорт
        </button>
        <button class="secondary" aria-pressed={mode === 'import'} onClick={() => toggle('import')}>
          Импорт
        </button>
        <button class="secondary danger" aria-pressed={mode === 'reset'} onClick={() => toggle('reset')}>
          Сброс
        </button>
      </div>
      {mode === 'export' && (
        <div class="data-body">
          <textarea readOnly rows={4} value={exported} onFocus={(e) => (e.currentTarget as HTMLTextAreaElement).select()} />
          <button class="primary wide" onClick={copy}>
            Скопировать
          </button>
        </div>
      )}
      {mode === 'import' && (
        <div class="data-body">
          <textarea
            rows={4}
            placeholder="Вставь сюда текст экспорта"
            value={text}
            onInput={(e) => setText((e.currentTarget as HTMLTextAreaElement).value)}
          />
          <button class="primary wide" disabled={!text.trim()} onClick={doImport}>
            Загрузить и заменить текущий прогресс
          </button>
        </div>
      )}
      {mode === 'reset' && (
        <div class="data-body">
          <p>Весь прогресс будет удалён. Это нельзя отменить (если нет экспорта).</p>
          <button
            class="primary wide danger"
            onClick={() => {
              onReset();
              setMode(null);
              setMsg('Прогресс сброшен.');
            }}
          >
            Да, сбросить прогресс
          </button>
        </div>
      )}
      {msg && (
        <p class="small" role="status">
          {msg}
        </p>
      )}
    </section>
  );
}
