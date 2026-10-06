import { useEffect, useRef, useState } from 'preact/hooks';
import type { Cell } from '../go/board';
import { sharedKataGo } from '../katago/shared';
import { type GameState, PASS, type SearchResult, applyMove, newGame } from '../katago/search';
import { KOMI } from '../katago/rules';
import { type CoachNote, describePosition, judgeUserMove, noteEngineMove } from '../play/coach';
import { adaptLevel, chooseMove } from '../play/levels';
import { loadPlay, movesOf, replay, savePlay, type SavedPlay } from '../play/saved';
import { type FinalScore, finalScore, resultText } from '../play/scoring';
import { haptic } from '../telegram';
import { Board, type MarkKind } from './Board';

/** Playouts per search; enough for a stable estimate, ~1 s on a modern phone. */
const VISITS = 120;

type Phase = 'loading' | 'user' | 'engine' | 'scoring' | 'over' | 'error';

interface Finished {
  score: FinalScore | null;
  resigned: 'user' | 'engine' | null;
  userWon: boolean;
  levelBefore: number;
  levelAfter: number;
}

interface Props {
  onSpeedTest: () => void;
}

export function GameView({ onSpeedTest }: Props) {
  const [saved, setSaved] = useState<SavedPlay>(loadPlay);
  const [game, setGame] = useState<GameState>(() => replay(saved.moves));
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<CoachNote[]>([]);
  const [explain, setExplain] = useState<{ lines: string[]; mark?: number } | null>(null);
  const [undo, setUndo] = useState<{ state: GameState; analysis: SearchResult | null } | null>(null);
  const [showArea, setShowArea] = useState(false);
  const [analysis, setAnalysis] = useState<SearchResult | null>(null);
  const [finished, setFinished] = useState<Finished | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [confirmResign, setConfirmResign] = useState(false);
  const pending = useRef<{ state: GameState; promise: Promise<SearchResult | null> } | null>(null);
  const alive = useRef(true);
  const lowStreak = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const persist = (s: GameState, patch: Partial<SavedPlay> = {}) => {
    setSaved((prev) => {
      const next = { ...prev, ...patch, moves: patch.moves ?? movesOf(s) };
      savePlay(next);
      return next;
    });
  };

  /** Background analysis of a position where the learner is to move. */
  const analyse = (s: GameState) => {
    const { client } = sharedKataGo();
    const promise = client
      .search(s, VISITS, true)
      .then((r) => r.result)
      .catch(() => null);
    pending.current = { state: s, promise };
    setAnalysis(null);
    void promise.then((r) => {
      if (alive.current && pending.current?.state === s) setAnalysis(r);
    });
    return promise;
  };

  const analysisFor = (s: GameState): Promise<SearchResult | null> =>
    pending.current?.state === s ? pending.current.promise : analyse(s);

  // Load the network, then resume the saved game.
  useEffect(() => {
    const { ready } = sharedKataGo();
    ready
      .then(() => {
        if (!alive.current) return;
        if (game.toPlay === 'W') void engineTurn(game, null, null);
        else {
          setPhase('user');
          analyse(game);
        }
      })
      .catch((e: Error) => {
        setError(e.message);
        setPhase('error');
      });
    // Runs once on mount; `game` is the restored game at that moment.
  }, []);

  const finish = async (s: GameState, resigned: Finished['resigned']) => {
    setPhase('scoring');
    let score: FinalScore | null = null;
    let userWon: boolean;
    if (resigned) {
      userWon = resigned === 'engine';
    } else {
      // Ownership of the final position decides which stones are dead.
      const { client } = sharedKataGo();
      const r = await client.search({ ...s, passes: 0 }, 1, true).catch(() => null);
      const own = r?.result.ownership ?? new Array<number>(81).fill(0);
      score = finalScore(s.board, own);
      userWon = score.score > 0;
    }
    const levelAfter = adaptLevel(saved.level, userWon);
    setFinished({ score, resigned, userWon, levelBefore: saved.level, levelAfter });
    persist(s, { moves: [], level: levelAfter, games: saved.games + 1, wins: saved.wins + (userWon ? 1 : 0) });
    setPhase('over');
    setUndo(null);
    haptic(userWon ? 'success' : 'warning');
  };

  const engineTurn = async (s: GameState, before: GameState | null, userMove: number | null) => {
    setPhase('engine');
    const { client } = sharedKataGo();
    const analysisBefore = before ? await analysisFor(before) : null;
    let res: SearchResult;
    try {
      res = (await client.search(s, VISITS)).result;
    } catch (e) {
      setError((e as Error).message);
      setPhase('error');
      return;
    }
    if (!alive.current) return;
    const out: CoachNote[] = [];
    let undoable = false;
    if (before && userMove !== null) {
      const note = judgeUserMove({ before, move: userMove, analysisBefore, analysisAfter: res });
      if (note) {
        out.push(note);
        undoable = note.kind === 'mistake' || note.kind === 'inaccuracy';
      }
    }
    // KataGo resigns when the game is clearly lost for it.
    lowStreak.current = res.winrate < 0.03 && res.lead < -20 ? lowStreak.current + 1 : 0;
    if (lowStreak.current >= 3 && s.history.length > 20) {
      setNotes(out);
      await finish(s, 'engine');
      return;
    }
    const move = chooseMove(res, saved.level);
    const after = applyMove(s, move) ?? applyMove(s, PASS)!;
    const engineNote = noteEngineMove(s, move);
    if (engineNote) out.push(engineNote);
    if (out.some((n) => n.kind === 'mistake' || n.kind === 'warning')) haptic('warning');
    setNotes(out);
    setUndo(undoable && before ? { state: before, analysis: analysisBefore } : null);
    setGame(after);
    persist(after);
    if (after.passes >= 2) {
      await finish(after, null);
      return;
    }
    setPhase('user');
    analyse(after);
  };

  const play = (point: number) => {
    if (phase !== 'user') return;
    const next = applyMove(game, point);
    if (!next) {
      setToast(game.board[point] ? 'Эта точка занята.' : point === game.ko ? 'Сейчас сюда нельзя: правило ко. Сыграй в другом месте.' : 'Сюда нельзя: у камня не будет свобод.');
      haptic('warning');
      return;
    }
    setToast(null);
    setExplain(null);
    setConfirmResign(false);
    const before = game;
    setGame(next);
    persist(next);
    if (next.passes >= 2) void finish(next, null);
    else void engineTurn(next, before, point);
  };

  const takeBack = () => {
    if (!undo || phase !== 'user') return;
    setGame(undo.state);
    persist(undo.state);
    setNotes([]);
    setExplain(null);
    setUndo(null);
    if (undo.analysis) {
      pending.current = { state: undo.state, promise: Promise.resolve(undo.analysis) };
      setAnalysis(undo.analysis);
    } else analyse(undo.state);
  };

  const whatsHappening = async () => {
    const a = analysis ?? (await analysisFor(game));
    setExplain(describePosition(game, a));
  };

  const startNew = () => {
    const s = newGame();
    setGame(s);
    setFinished(null);
    setNotes([]);
    setExplain(null);
    setUndo(null);
    setShowArea(false);
    lowStreak.current = 0;
    persist(s, { moves: [] });
    setPhase('user');
    analyse(s);
  };

  // Board decorations.
  const last = game.history[game.history.length - 1];
  const markNote = notes.find((n) => n.mark !== undefined);
  let ring: { point: number; kind: MarkKind } | null = null;
  if (explain?.mark !== undefined) ring = { point: explain.mark, kind: 'good' };
  else if (markNote?.mark !== undefined) ring = { point: markNote.mark, kind: markNote.kind === 'warning' ? 'bad' : 'better' };
  let area: Cell[] | null = null;
  if (finished?.score) area = finished.score.area;
  else if (showArea && analysis?.ownership) area = analysis.ownership.map((o) => (o > 0.3 ? 'B' : o < -0.3 ? 'W' : null));

  const status =
    phase === 'loading'
      ? 'Загружаю KataGo…'
      : phase === 'engine'
        ? 'KataGo думает…'
        : phase === 'scoring'
          ? 'Считаю очки…'
          : phase === 'user'
            ? game.history.length === 0
              ? 'Твой ход: ты играешь чёрными.'
              : 'Твой ход.'
            : '';

  return (
    <div class="game">
      <h2 class="problem-title">Партия с KataGo</h2>
      <p class="muted small game-stats">
        уровень {saved.level} · партий {saved.games}, побед {saved.wins}
      </p>
      <p class="to-play">
        <span class="dot black" /> {status || `Коми ${KOMI}`}
      </p>

      {error && <p class="toast">Не удалось запустить KataGo: {error}</p>}

      <div class="board-wrap">
        <Board
          board={game.board}
          toPlay="B"
          interactive={phase === 'user'}
          lastMove={last && last.point !== PASS ? last.point : null}
          targets={[]}
          ring={ring}
          onPlay={play}
          area={area}
          dim={finished?.score?.dead}
        />
      </div>
      {toast && <p class="toast">{toast}</p>}

      <div class="feedback-area" aria-live="polite">
        {finished && (
          <div class={`feedback ${finished.userWon ? 'correct' : 'wrong'}`}>
            <h3>{finished.userWon ? 'Победа!' : 'Поражение'}</h3>
            <p>
              {finished.resigned === 'user'
                ? 'Ты сдался.'
                : finished.resigned === 'engine'
                  ? 'KataGo сдался: позиция для него безнадёжна.'
                  : `${resultText(finished.score!.score)} (чёрные ${finished.score!.black}, белые ${finished.score!.white} с коми). Полупрозрачные камни — мёртвые, квадратики — территория.`}
            </p>
            <p class="small">
              {finished.levelAfter > finished.levelBefore
                ? `KataGo станет сильнее: уровень ${finished.levelAfter}.`
                : finished.levelAfter < finished.levelBefore
                  ? `KataGo станет слабее: уровень ${finished.levelAfter}.`
                  : `Уровень KataGo: ${finished.levelAfter}.`}
            </p>
          </div>
        )}
        {notes.map((n, i) => (
          <div key={i} class={`feedback ${n.kind === 'good' ? 'correct' : n.kind === 'mistake' ? 'wrong' : n.kind === 'info' ? 'solution' : 'better'}`}>
            <h3>{n.title}</h3>
            <p>{n.text}</p>
          </div>
        ))}
        {explain && (
          <div class="hints">
            {explain.lines.map((l, i) => (
              <p key={i}>{l}</p>
            ))}
          </div>
        )}
      </div>

      <div class="actions">
        {phase === 'over' ? (
          <button class="primary" onClick={startNew}>
            Новая партия
          </button>
        ) : (
          <>
            {undo && phase === 'user' && (
              <button class="primary" onClick={takeBack}>
                Вернуть ход
              </button>
            )}
            <button class="secondary" disabled={phase !== 'user'} onClick={() => void whatsHappening()}>
              Что здесь происходит?
            </button>
            <button class="secondary" disabled={phase !== 'user'} onClick={() => play(PASS)}>
              Пас
            </button>
          </>
        )}
      </div>
      <div class="game-links">
        {phase !== 'over' && (
          <button class="link" disabled={!analysis?.ownership} aria-pressed={showArea} onClick={() => setShowArea(!showArea)}>
            {showArea ? 'Скрыть территорию' : 'Показать территорию'}
          </button>
        )}
        {phase === 'user' &&
          (confirmResign ? (
            <button class="link danger-link" onClick={() => void finish(game, 'user')}>
              Точно сдаться?
            </button>
          ) : (
            <button class="link" onClick={() => setConfirmResign(true)}>
              Сдаться
            </button>
          ))}
        <button class="link" onClick={onSpeedTest}>
          Проверка скорости
        </button>
      </div>
    </div>
  );
}
