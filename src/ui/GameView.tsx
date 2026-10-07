import { useEffect, useRef, useState } from 'preact/hooks';
import { type Cell, other, pointName } from '../go/board';
import { MODELS, modelChoice, onModelProgress, sharedKataGo } from '../katago/shared';
import { type GameState, PASS, type SearchResult, applyMove, newGame } from '../katago/search';
import { KOMI } from '../katago/rules';
import { type CoachNote, type PositionView, describePosition, judgeUserMove, noteEngineMove } from '../play/coach';
import { explainComparison, explainMove, tacticalClause } from '../play/explain';
import { adaptLevel, chooseMove } from '../play/levels';
import { loadPlay, movesOf, replay, savePlay, type SavedPlay } from '../play/saved';
import { type FinalScore, finalScore, resultText } from '../play/scoring';
import { haptic } from '../telegram';
import { Board, type MarkKind } from './Board';

const moveName = (m: number) => (m === PASS ? 'пас' : pointName(m));


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
  const [explain, setExplain] = useState<PositionView | null>(null);
  /** Notes (by index; -1 = the position description) whose exact move was revealed. */
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [undo, setUndo] = useState<{ state: GameState; analysis: SearchResult | null } | null>(null);
  const [showArea, setShowArea] = useState(false);
  const [analysis, setAnalysis] = useState<SearchResult | null>(null);
  const [finished, setFinished] = useState<Finished | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [confirmResign, setConfirmResign] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  const [variation, setVariation] = useState<{ label: string; from: GameState; moves: number[]; step: number } | null>(null);
  const pending = useRef<{ state: GameState; promise: Promise<SearchResult | null> } | null>(null);
  const alive = useRef(true);
  const lowStreak = useRef(0);
  /** Playouts per search for the chosen network (fixed while this screen is open). */
  const [visits] = useState(() => MODELS[modelChoice()].visits);
  const [download, setDownload] = useState<number | null>(null);

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
      .search(s, visits, true)
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
    const off = onModelProgress(({ loaded, total }) => {
      if (total > 0) setDownload(Math.min(100, Math.round((loaded / total) * 100)));
    });
    void ready.finally(off);
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
      res = (await client.search(s, visits, true)).result;
    } catch (e) {
      setError((e as Error).message);
      setPhase('error');
      return;
    }
    if (!alive.current) return;
    const out: CoachNote[] = [];
    let undoable = false;

    // 1. The learner's move: what it did, or why another move was better.
    if (before && userMove !== null) {
      const me = before.toPlay;
      const note = judgeUserMove({ before, move: userMove, analysisBefore, analysisAfter: res });
      if (note && (note.kind === 'mistake' || note.kind === 'inaccuracy')) {
        undoable = true;
        const best = analysisBefore?.moves[0];
        if (best && best.move !== PASS) {
          const bestLine = [best.move, ...best.pv];
          const reply = res.moves[0];
          const userLine = [userMove, ...(reply ? [reply.move, ...reply.pv] : [])];
          const [la, lb] = await Promise.all([client.line(before, bestLine), client.line(before, userLine)]).catch(
            () => [null, null] as const,
          );
          if (la && lb) {
            const cmp = {
              board: before.board,
              learner: me,
              move: userMove,
              best: best.move,
              bestEnd: la.ownership,
              moveEnd: lb.ownership,
              loss: note.loss ?? 0,
            };
            note.details = explainComparison({ ...cmp, hideBest: true });
            note.revealDetails = explainComparison(cmp);
          }
          note.lines = [
            { label: `Что будет после ${moveName(userMove)}`, from: before, moves: userLine.slice(0, lb?.played ?? userLine.length) },
            {
              label: `Вариант с ${moveName(best.move)}`,
              from: before,
              moves: bestLine.slice(0, la?.played ?? bestLine.length),
              hidden: true,
            },
          ];
        }
        out.push(note);
      } else {
        const lines = explainMove({
          board: before.board,
          move: userMove,
          color: me,
          learner: me,
          before: analysisBefore?.ownership ?? null,
          after: res.ownership ?? null,
        });
        if (note) out.push({ ...note, details: lines.slice(1) });
        else out.push({ kind: 'info', title: `Твой ход ${moveName(userMove)}`, text: lines[0]!, details: lines.slice(1) });
      }
    }

    // KataGo resigns when the game is clearly lost for it.
    lowStreak.current = res.winrate < 0.03 && res.lead < -20 ? lowStreak.current + 1 : 0;
    if (lowStreak.current >= 3 && s.history.length > 20) {
      setNotes(out);
    setRevealed(new Set());
      await finish(s, 'engine');
      return;
    }

    // 2. KataGo's move, and what it is aiming at (filled in once the next analysis is ready).
    const move = chooseMove(res, saved.level);
    const after = applyMove(s, move) ?? applyMove(s, PASS)!;
    const playedMove = after.history[after.history.length - 1]!.point;
    const warning = noteEngineMove(s, playedMove);
    const chosen = res.moves.find((m) => m.move === playedMove);
    const engineNote: CoachNote | null =
      playedMove === PASS
        ? null
        : {
            kind: 'info',
            title: `Белые: ${moveName(playedMove)}`,
            text: 'Разбираю ход…',
            lines: chosen ? [{ label: 'Чего хотят белые', from: s, moves: [playedMove, ...chosen.pv] }] : undefined,
          };
    if (warning) out.push(warning);
    if (engineNote) out.push(engineNote);
    if (out.some((n) => n.kind === 'mistake' || n.kind === 'warning')) haptic('warning');
    setNotes(out);
    setRevealed(new Set());
    setUndo(undoable && before ? { state: before, analysis: analysisBefore } : null);
    setGame(after);
    persist(after);
    if (after.passes >= 2) {
      await finish(after, null);
      return;
    }
    setPhase('user');
    const next = analyse(after);
    if (engineNote) {
      void next.then((a) => {
        if (!alive.current) return;
        let lines = explainMove({
          board: s.board,
          move: playedMove,
          color: s.toPlay,
          learner: other(s.toPlay),
          before: res.ownership ?? null,
          after: a?.ownership ?? null,
        });
        // The atari / capture is already announced by the warning above.
        if (warning && tacticalClause(s.board, playedMove, s.toPlay, other(s.toPlay))) lines = lines.slice(1);
        setNotes((prev) =>
          prev.flatMap((n) => (n !== engineNote ? [n] : lines.length ? [{ ...n, text: lines[0]!, details: lines.slice(1) }] : [])),
        );
      });
    }
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
    setConfirmNew(false);
    setVariation(null);
    const before = game;
    setGame(next);
    persist(next);
    if (next.passes >= 2) void finish(next, null);
    else void engineTurn(next, before, point);
  };

  const takeBack = () => {
    if (!undo || phase !== 'user') return;
    setVariation(null);
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
    setRevealed((prev) => {
      const next = new Set(prev);
      next.delete(-1);
      return next;
    });
  };

  const startNew = () => {
    const s = newGame();
    setGame(s);
    setVariation(null);
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

  // A variation being viewed replaces the game position on the board.
  let shown = game;
  let labels: Map<number, string> | undefined;
  if (variation) {
    shown = variation.from;
    labels = new Map();
    for (const [i, m] of variation.moves.slice(0, variation.step).entries()) {
      const n = applyMove(shown, m);
      if (!n) break;
      shown = n;
      if (m !== PASS) labels.set(m, String(i + 1));
    }
    for (const p of [...labels.keys()]) if (!shown.board[p]) labels.delete(p);
  }

  // Board decorations.
  const last = shown.history[shown.history.length - 1];
  // Hints show an area; the exact point appears only after "Показать точный ход".
  let ring: { point: number; kind: MarkKind } | null = null;
  let zone: number[] | undefined;
  if (!variation) {
    if (explain) {
      if (revealed.has(-1) && explain.mark !== undefined) ring = { point: explain.mark, kind: 'good' };
      else zone = explain.zone?.points;
    } else {
      const i = notes.findIndex((n) => n.mark !== undefined || n.zone);
      const n = notes[i];
      if (n && revealed.has(i) && n.mark !== undefined) ring = { point: n.mark, kind: 'better' };
      else if (n) zone = n.zone?.points;
    }
  }
  const reveal = (i: number) => setRevealed((prev) => new Set(prev).add(i));
  let area: Cell[] | null = null;
  if (variation) area = null;
  else if (finished?.score) area = finished.score.area;
  else if (showArea && analysis?.ownership) area = analysis.ownership.map((o) => (o > 0.3 ? 'B' : o < -0.3 ? 'W' : null));

  const status =
    phase === 'loading'
      ? download !== null && download < 100
        ? `Скачиваю сеть KataGo: ${download}% (один раз, потом работает без интернета)…`
        : 'Загружаю KataGo…'
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
        <span class="dot black" /> {variation ? `${variation.label}: ход ${variation.step} из ${variation.moves.length}` : status || `Коми ${KOMI}`}
      </p>

      {error && <p class="toast">Не удалось запустить KataGo: {error}</p>}

      <div class="board-wrap">
        <Board
          board={shown.board}
          labels={labels}
          toPlay="B"
          interactive={phase === 'user' && !variation}
          lastMove={last && last.point !== PASS ? last.point : null}
          targets={[]}
          ring={ring}
          onPlay={play}
          area={area}
          dim={variation ? undefined : finished?.score?.dead}
          zone={zone}
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
        {explain && (
          <div class="hints">
            {explain.lines.map((l, i) => (
              <p key={i}>{l}</p>
            ))}
            {explain.reveal &&
              (revealed.has(-1) ? (
                <p>{explain.reveal}</p>
              ) : (
                <button class="link reveal-btn" onClick={() => reveal(-1)}>
                  Показать точный ход
                </button>
              ))}
          </div>
        )}
        {notes.map((n, i) => (
          <div key={i} class={`feedback ${n.kind === 'good' ? 'correct' : n.kind === 'mistake' ? 'wrong' : n.kind === 'info' ? 'solution' : 'better'}`}>
            <h3>{n.title}</h3>
            <p>{n.text}</p>
            {(revealed.has(i) && n.revealDetails ? n.revealDetails : n.details)?.map((d, j) => (
              <p key={j}>{d}</p>
            ))}
            {revealed.has(i) && n.reveal && <p>{n.reveal}</p>}
            {n.reveal && !revealed.has(i) && (
              <button class="link reveal-btn" onClick={() => reveal(i)}>
                Показать точный ход
              </button>
            )}
            {n.lines && n.lines.some((l) => l.moves.length > 0 && (!l.hidden || revealed.has(i))) && (
              <div class="note-lines">
                {n.lines
                  .filter((l) => l.moves.length > 0 && (!l.hidden || revealed.has(i)))
                  .map((l, j) => (
                    <button key={j} class="link" onClick={() => setVariation({ ...l, step: l.moves.length })}>
                      ▶ {l.label}
                    </button>
                  ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div class="actions">
        {variation ? (
          <>
            <button class="secondary" disabled={variation.step <= 1} onClick={() => setVariation({ ...variation, step: variation.step - 1 })}>
              ◀ Назад
            </button>
            <button
              class="secondary"
              disabled={variation.step >= variation.moves.length}
              onClick={() => setVariation({ ...variation, step: variation.step + 1 })}
            >
              Дальше ▶
            </button>
            <button class="primary" onClick={() => setVariation(null)}>
              Вернуться к партии
            </button>
          </>
        ) : phase === 'over' ? (
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
            <button
              class="link"
              onClick={() => {
                setConfirmResign(true);
                setConfirmNew(false);
              }}
            >
              Сдаться
            </button>
          ))}
        {phase === 'user' &&
          game.history.length > 0 &&
          (confirmNew ? (
            <button
              class="link danger-link"
              onClick={() => {
                setConfirmNew(false);
                startNew();
              }}
            >
              Начать заново? Эта партия не засчитается
            </button>
          ) : (
            <button
              class="link"
              onClick={() => {
                setConfirmNew(true);
                setConfirmResign(false);
              }}
            >
              Новая партия
            </button>
          ))}
        <button class="link" onClick={onSpeedTest}>
          Проверка скорости
        </button>
      </div>
    </div>
  );
}
