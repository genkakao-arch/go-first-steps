import { useEffect, useRef, useState } from 'preact/hooks';
import { pointName } from '../go/board';
import type { KataGoClient } from '../katago/client';
import { sharedKataGo } from '../katago/shared';
import type { Backend } from '../katago/net';
import { type GameState, PASS, applyMove, areaScore, newGame } from '../katago/search';
import { Board } from './Board';

const VISIT_OPTIONS = [16, 64, 200];

interface Info {
  backend: Backend;
  modelName: string;
  modelMb: number;
  loadMs: number;
  notes: string[];
}

interface Thought {
  ms: number;
  visits: number;
  winrateForYou: number;
  leadForYou: number;
}

const fmt = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} с` : `${Math.round(ms)} мс`);
const moveName = (m: number) => (m === PASS ? 'пас' : pointName(m));

export function KataGoLab() {
  const client = useRef<KataGoClient | null>(null);
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bench, setBench] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>('Загружаю KataGo…');
  const [game, setGame] = useState<GameState>(newGame);
  const [visits, setVisits] = useState(64);
  const [thought, setThought] = useState<Thought | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const { client: c, ready } = sharedKataGo();
    client.current = c;
    ready
      .then((r) =>
        setInfo({ backend: r.backend, modelName: r.modelName, modelMb: r.modelBytes / 1e6, loadMs: r.ms, notes: r.notes }),
      )
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  }, []);

  const runBench = async () => {
    if (!client.current) return;
    setBusy('Замеряю скорость…');
    try {
      const r = await client.current.bench(20);
      setBench(`одна оценка позиции: в среднем ${fmt(r.avgMs)}, лучшая ${fmt(r.minMs)} (${r.runs} замеров)`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const over = game.passes >= 2;

  const engineMove = async (s: GameState) => {
    if (!client.current) return;
    setBusy('KataGo думает…');
    try {
      const r = await client.current.search(s, visits);
      const after = applyMove(s, r.result.move) ?? applyMove(s, PASS)!;
      setGame(after);
      setThought({
        ms: r.ms,
        visits: r.result.visits,
        // Search values are for the side to move (KataGo = white here).
        winrateForYou: 1 - r.result.winrate,
        leadForYou: -r.result.lead,
      });
      if (r.result.move === PASS) setToast('KataGo пасует.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const playUser = (point: number) => {
    if (busy || over || game.toPlay !== 'B') return;
    const next = applyMove(game, point);
    if (!next) {
      setToast(game.board[point] ? 'Эта точка занята.' : point === game.ko ? 'Сейчас нельзя: правило ко.' : 'Сюда ходить нельзя.');
      return;
    }
    setToast(null);
    setGame(next);
    void engineMove(next);
  };

  const pass = () => {
    if (busy || over) return;
    const next = applyMove(game, PASS)!;
    setGame(next);
    if (next.passes < 2) void engineMove(next);
  };

  const last = game.history[game.history.length - 1];
  const score = over ? areaScore(game.board) : 0;

  return (
    <div class="lab">
      <h1>KataGo: прототип</h1>
      <p class="muted small">Проверка, насколько быстро KataGo думает прямо на телефоне, без сервера.</p>

      <section class="card">
        {error && <p class="toast">Ошибка: {error}</p>}
        {!info && !error && <p>{busy}</p>}
        {info && (
          <ul class="facts">
            <li>
              Ускорение: <b>{info.backend === 'webgpu' ? 'WebGPU (видеочип)' : info.backend === 'wasm' ? 'WASM (процессор)' : 'JS (медленно)'}</b>
            </li>
            <li>
              Сеть: {info.modelName} ({info.modelMb.toFixed(1)} МБ), загрузка {fmt(info.loadMs)}
            </li>
            {info.notes.length > 0 && <li class="muted small">{info.notes.join('; ')}</li>}
            {bench && <li>{bench}</li>}
          </ul>
        )}
        {info && (
          <button class="secondary wide" disabled={!!busy} onClick={runBench}>
            Замерить скорость
          </button>
        )}
      </section>

      {info && (
        <>
          <div class="lab-controls">
            <span class="muted small">Сила (вариантов на ход):</span>
            {VISIT_OPTIONS.map((v) => (
              <button key={v} class={v === visits ? 'chip on' : 'chip'} onClick={() => setVisits(v)}>
                {v}
              </button>
            ))}
          </div>
          <p class="to-play">
            <span class="dot black" /> Ты — чёрные, KataGo — белые, коми {7}
          </p>
          <div class="board-wrap">
            <Board
              board={game.board}
              toPlay="B"
              interactive={!busy && !over && game.toPlay === 'B'}
              lastMove={last && last.point !== PASS ? last.point : null}
              targets={[]}
              ring={null}
              onPlay={playUser}
            />
          </div>
          {toast && <p class="toast">{toast}</p>}
          <div class="feedback-area">
            {busy && info && <p class="muted">{busy}</p>}
            {thought && !busy && (
              <div class="feedback solution">
                <p>
                  Ход белых: <b>{last ? moveName(last.point) : '—'}</b> — думал {fmt(thought.ms)} ({thought.visits} вариантов,{' '}
                  {fmt(thought.ms / Math.max(1, thought.visits))} на вариант).
                </p>
                <p class="small">
                  Оценка KataGo: твои шансы {Math.round(thought.winrateForYou * 100)}%, счёт {thought.leadForYou >= 0 ? '+' : ''}
                  {thought.leadForYou.toFixed(1)} в твою пользу.
                </p>
              </div>
            )}
            {over && (
              <div class="feedback correct">
                <h3>Партия окончена</h3>
                <p>
                  Подсчёт по площади (все камни на доске считаются живыми): {score > 0 ? 'чёрные' : 'белые'} выигрывают на{' '}
                  {Math.abs(score)}.
                </p>
              </div>
            )}
          </div>
          <div class="actions">
            <button class="secondary" disabled={!!busy || over} onClick={pass}>
              Пас
            </button>
            <button
              class="secondary"
              disabled={!!busy}
              onClick={() => {
                setGame(newGame());
                setThought(null);
                setToast(null);
              }}
            >
              Новая партия
            </button>
          </div>
        </>
      )}
    </div>
  );
}
