import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Cell } from '../go/board';
import { parsePoint } from '../go/board';
import { type Frame, evaluateMove, solutionFrames, startBoard } from '../go/evaluate';
import type { Problem } from '../data/types';
import type { ProblemProgress } from '../progress';
import { haptic } from '../telegram';
import { Board, type MarkKind } from './Board';

export type AttemptKind = 'correct' | 'better' | 'wrong';

interface Props {
  problem: Problem;
  number: number;
  total: number;
  topicTitle: string;
  state: ProblemProgress;
  hasNext: boolean;
  onAttempt: (kind: AttemptKind) => void;
  onHint: () => void;
  onReveal: () => void;
  onNext: () => void;
  onTheory: () => void;
}

type Phase = 'play' | 'result' | 'solution';

interface Feedback {
  kind: AttemptKind | 'solution';
  title: string;
  text: string;
  /** General lesson of the problem, shown under a move-specific explanation. */
  extra?: string;
}

const TITLES: Record<AttemptKind, string> = {
  correct: 'Правильно',
  better: 'Можно лучше',
  wrong: 'Попробуй ещё',
};

/** Wrong attempts needed before "Показать решение" appears. */
export const REVEAL_AFTER = 3;

export function ProblemView(props: Props) {
  const { problem, state } = props;
  const start = useMemo(() => startBoard(problem), [problem]);
  const [board, setBoard] = useState<Cell[]>(start);
  const [lastMove, setLastMove] = useState<number | null>(null);
  const [ring, setRing] = useState<{ point: number; kind: MarkKind } | null>(null);
  const [phase, setPhase] = useState<Phase>('play');
  const [animating, setAnimating] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [wrong, setWrong] = useState(0);
  const [hintsShown, setHintsShown] = useState(Math.min(state.hints, problem.hints.length));
  const [toast, setToast] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const feedbackRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const stopAnimation = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setAnimating(false);
  };

  const animate = (frames: Frame[]) => {
    stopAnimation();
    const show = (f: Frame) => {
      setBoard(f.board);
      setLastMove(f.move);
    };
    show(frames[0]!);
    if (frames.length === 1) return;
    setAnimating(true);
    const step = frames.length > 7 ? 380 : 650;
    frames.slice(1).forEach((f, i) => {
      timers.current.push(
        setTimeout(() => {
          show(f);
          if (i === frames.length - 2) setAnimating(false);
        }, step * (i + 1)),
      );
    });
  };

  const scrollToFeedback = () =>
    requestAnimationFrame(() => feedbackRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));

  const play = (point: number) => {
    if (phase !== 'play') return;
    const out = evaluateMove(problem, start, point);
    if (out.kind === 'illegal') {
      haptic('warning');
      setToast(
        out.reason === 'occupied'
          ? 'Эта точка уже занята.'
          : 'Сюда ходить нельзя: у камня не будет ни одной свободы, и он ничего не захватывает.',
      );
      return;
    }
    setToast(null);
    animate(out.frames);
    const kind: AttemptKind = out.verdict;
    setRing({ point, kind: kind === 'correct' ? 'good' : kind === 'better' ? 'better' : 'bad' });
    const extra = kind === 'correct' && out.answer?.text ? problem.explanation : undefined;
    setFeedback({ kind, title: TITLES[kind], text: out.text, extra });
    setPhase('result');
    if (kind === 'wrong') setWrong((w) => w + 1);
    haptic(kind === 'correct' ? 'success' : kind === 'better' ? 'warning' : 'error');
    props.onAttempt(kind);
    scrollToFeedback();
  };

  const retry = () => {
    stopAnimation();
    setBoard(start);
    setLastMove(null);
    setRing(null);
    setFeedback(null);
    setPhase('play');
  };

  const showHint = () => {
    if (hintsShown >= problem.hints.length) return;
    setHintsShown(hintsShown + 1);
    if (hintsShown + 1 > state.hints) props.onHint();
    scrollToFeedback();
  };

  const reveal = () => {
    const frames = solutionFrames(problem, start);
    animate(frames);
    setRing({ point: parsePoint(problem.solutions[0]!.move), kind: 'good' });
    const sol = problem.solutions[0]!;
    setFeedback({
      kind: 'solution',
      title: `Решение: ${sol.move}`,
      text: sol.text ?? problem.explanation,
      extra: sol.text ? problem.explanation : undefined,
    });
    setPhase('solution');
    if (!state.solved) props.onReveal();
    scrollToFeedback();
  };

  const allHints = hintsShown >= problem.hints.length;
  const canReveal = !state.solved && (wrong >= REVEAL_AFTER || (wrong >= 2 && allHints) || state.revealed);
  const done = phase === 'solution' || feedback?.kind === 'correct';
  const targets = useMemo(() => (problem.marks ?? []).map(parsePoint), [problem]);

  return (
    <div class="problem">
      <div class="problem-head">
        <div class="crumbs">
          <span>{props.topicTitle}</span>
          <span class="muted">
            {props.number} / {props.total}
          </span>
        </div>
        <button class="link" onClick={props.onTheory}>
          Теория
        </button>
      </div>
      <h2 class="problem-title">
        {problem.title}
        {state.solved && <span class="badge ok">решена</span>}
      </h2>
      <p class="prompt">{problem.prompt}</p>
      <p class="to-play">
        <span class="dot black" /> Ход чёрных
      </p>

      <div class="board-wrap">
        <Board
          board={board}
          toPlay={problem.toPlay}
          interactive={phase === 'play'}
          lastMove={lastMove}
          targets={phase === 'play' ? targets : []}
          ring={ring}
          onPlay={play}
        />
      </div>

      {toast && phase === 'play' && (
        <p class="toast" role="status">
          {toast}
        </p>
      )}

      <div ref={feedbackRef} class="feedback-area" aria-live="polite">
        {feedback && (
          <div class={`feedback ${feedback.kind}`}>
            <h3>{feedback.title}</h3>
            <p>{feedback.text}</p>
            {feedback.extra && <p>{feedback.extra}</p>}
            {animating && <p class="muted small">Смотри продолжение на доске…</p>}
          </div>
        )}
        {hintsShown > 0 && !done && (
          <div class="hints">
            {problem.hints.slice(0, hintsShown).map((h, i) => (
              <p key={i}>
                <span class="hint-n">Подсказка {i + 1}.</span> {h}
              </p>
            ))}
          </div>
        )}
        {phase === 'play' && !feedback && wrong > 0 && !canReveal && !state.solved && (
          <p class="muted small">Решение можно будет открыть после {REVEAL_AFTER} попыток.</p>
        )}
      </div>

      <div class="actions">
        {done ? (
          <>
            <button class="secondary" onClick={retry}>
              Ещё раз
            </button>
            {props.hasNext ? (
              <button class="primary" onClick={props.onNext}>
                Следующая задача
              </button>
            ) : (
              <button class="primary" onClick={props.onNext}>
                К темам
              </button>
            )}
          </>
        ) : (
          <>
            {phase === 'result' && (
              <button class="primary" onClick={retry}>
                Попробовать ещё
              </button>
            )}
            {!allHints && (
              <button class={phase === 'result' ? 'secondary' : 'secondary grow'} onClick={showHint}>
                Подсказка {hintsShown + 1}/{problem.hints.length}
              </button>
            )}
            {canReveal && (
              <button class="secondary" onClick={reveal}>
                Показать решение
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
