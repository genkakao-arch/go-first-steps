import { useEffect, useState } from 'preact/hooks';
import type { Backend } from '../katago/net';
import { newGame } from '../katago/search';
import { MODELS, type ModelId, chooseModel, modelChoice, onModelProgress, sharedKataGo } from '../katago/shared';

interface Info {
  backend: Backend;
  modelName: string;
  modelMb: number;
  loadMs: number;
  notes: string[];
}

const fmt = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} с` : `${Math.round(ms)} мс`);

export function KataGoLab() {
  const [model, setModel] = useState<ModelId>(modelChoice);
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bench, setBench] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [download, setDownload] = useState<number | null>(null);

  // (Re)load whenever the chosen network changes.
  useEffect(() => {
    let alive = true;
    setInfo(null);
    setError(null);
    setBench([]);
    setBusy('Загружаю KataGo…');
    setDownload(null);
    const off = onModelProgress(({ loaded, total }) => {
      if (alive && total > 0) setDownload(Math.min(100, Math.round((loaded / total) * 100)));
    });
    const { ready } = sharedKataGo();
    ready
      .then((r) => {
        if (alive) setInfo({ backend: r.backend, modelName: r.modelName, modelMb: r.modelBytes / 1e6, loadMs: r.ms, notes: r.notes });
      })
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setBusy(null));
    return () => {
      alive = false;
      off();
    };
  }, [model]);

  const pick = (id: ModelId) => {
    if (id === model || busy) return;
    chooseModel(id);
    setModel(id);
  };

  const runBench = async () => {
    const { client } = sharedKataGo();
    setBusy('Замеряю скорость…');
    try {
      const r = await client.bench(10);
      const visits = MODELS[model].visits;
      const s = await client.search(newGame(), visits);
      setBench([
        `Одна оценка позиции: в среднем ${fmt(r.avgMs)}, лучшая ${fmt(r.minMs)}.`,
        `Ход в партии (${visits} вариантов): ${fmt(s.ms)}.`,
      ]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div class="lab">
      <h1>Сеть KataGo</h1>
      <p class="muted small">KataGo думает прямо на телефоне, без сервера. Выбранная сеть используется в партии.</p>

      <section class="card">
        <h2>Какую сеть использовать</h2>
        <div class="model-choice">
          {(Object.keys(MODELS) as ModelId[]).map((id) => (
            <button key={id} class={id === model ? 'chip on' : 'chip'} disabled={!!busy && id !== model} onClick={() => pick(id)}>
              {MODELS[id].label} ({MODELS[id].mb} МБ)
            </button>
          ))}
        </div>
        <p class="muted small">
          {model === 'strong'
            ? 'Обучена специально для доски 9×9: точнее оценивает группы и территорию, но тяжелее. Скачивается один раз (лучше по Wi‑Fi), потом работает без интернета.'
            : 'Маленькая и быстрая: играет намного сильнее новичка, но иногда ошибается в оценке позиции.'}
        </p>
      </section>

      <section class="card">
        {error && <p class="toast">Ошибка: {error}</p>}
        {!info && !error && (
          <p>
            {busy}
            {download !== null && download < 100 ? ` Скачано ${download}%.` : download === 100 ? ' Готовлю сеть…' : ''}
          </p>
        )}
        {download !== null && download < 100 && !info && (
          <div class="bar" role="progressbar" aria-valuenow={download} aria-valuemin={0} aria-valuemax={100}>
            <div style={{ width: `${download}%` }} />
          </div>
        )}
        {info && (
          <ul class="facts">
            <li>
              Ускорение: <b>{info.backend === 'webgpu' ? 'WebGPU (видеочип)' : info.backend === 'wasm' ? 'WASM (процессор)' : 'JS (медленно)'}</b>
            </li>
            <li>
              Сеть: {info.modelName} ({info.modelMb.toFixed(1)} МБ), загрузка {fmt(info.loadMs)}
            </li>
            {info.notes.length > 0 && <li class="muted small">{info.notes.join('; ')}</li>}
            {bench.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        )}
        {info && (
          <button class="secondary wide" disabled={!!busy} onClick={runBench}>
            {busy === 'Замеряю скорость…' ? busy : 'Замерить скорость'}
          </button>
        )}
      </section>
    </div>
  );
}
