import { useRef, useState } from 'preact/hooks';
import { type Board as BoardT, type Cell, type Color, SIZE, colLabel, toIndex, toXY } from '../go/board';

export type MarkKind = 'good' | 'bad' | 'better';

interface Props {
  board: BoardT;
  toPlay: Color;
  interactive: boolean;
  lastMove: number | null;
  /** Stones the problem is about (triangles). */
  targets: number[];
  /** Coloured ring on a point (result of the user's move, or the solution). */
  ring: { point: number; kind: MarkKind } | null;
  onPlay: (point: number) => void;
  /** Territory overlay: owner of each point, drawn as small squares. */
  area?: readonly Cell[] | null;
  /** Stones drawn faded (dead stones at the end of a game). */
  dim?: readonly number[];
}

const STAR = [toIndex(2, 2), toIndex(6, 2), toIndex(2, 6), toIndex(6, 6), toIndex(4, 4)];
// Grid spans 0..8; the margin holds coordinates and doubles as a touch area for edge points.
const MARGIN = 0.95;
const MIN = -MARGIN;
const SPAN = SIZE - 1 + MARGIN * 2;
/** Max distance (in cells) from an intersection for a touch to count. */
const SNAP = 0.72;

export function Board({ board, toPlay, interactive, lastMove, targets, ring, onPlay, area, dim }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [ghost, setGhost] = useState<number | null>(null);
  const activePointer = useRef<number | null>(null);

  const pointAt = (e: PointerEvent): number | null => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    const x = Math.round(pt.x);
    const y = Math.round(pt.y);
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return null;
    if (Math.hypot(pt.x - x, pt.y - y) > SNAP) return null;
    return toIndex(x, y);
  };

  const onDown = (e: PointerEvent) => {
    if (!interactive || activePointer.current !== null) return;
    activePointer.current = e.pointerId;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setGhost(pointAt(e));
  };
  const onMove = (e: PointerEvent) => {
    if (activePointer.current !== e.pointerId) return;
    setGhost(pointAt(e));
  };
  const onUp = (e: PointerEvent) => {
    if (activePointer.current !== e.pointerId) return;
    activePointer.current = null;
    const p = pointAt(e);
    setGhost(null);
    if (p !== null && interactive) onPlay(p);
  };
  const onCancel = () => {
    activePointer.current = null;
    setGhost(null);
  };

  const lines = [];
  for (let i = 0; i < SIZE; i++) {
    lines.push(<line key={`h${i}`} x1={0} y1={i} x2={SIZE - 1} y2={i} />);
    lines.push(<line key={`v${i}`} x1={i} y1={0} x2={i} y2={SIZE - 1} />);
  }

  const labels = [];
  for (let i = 0; i < SIZE; i++) {
    labels.push(
      <text key={`c${i}`} x={i} y={SIZE - 1 + 0.6}>
        {colLabel(i)}
      </text>,
    );
    labels.push(
      <text key={`r${i}`} x={-0.6} y={i + 0.02}>
        {SIZE - i}
      </text>,
    );
  }

  const stones = [];
  for (let i = 0; i < board.length; i++) {
    const c = board[i];
    if (!c) continue;
    const [x, y] = toXY(i);
    const faded = dim?.includes(i) ? ' dead' : '';
    stones.push(<circle key={`s${i}`} class={`stone ${c === 'B' ? 'black' : 'white'}${faded}`} cx={x} cy={y} r={0.47} />);
  }

  const markFor = (i: number) => (board[i] === 'B' ? 'on-black' : 'on-white');

  return (
    <svg
      ref={svgRef}
      class={`board${interactive ? ' interactive' : ''}`}
      viewBox={`${MIN} ${MIN} ${SPAN} ${SPAN}`}
      role="img"
      aria-label="Доска 9×9"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onCancel}
    >
      <rect class="wood" x={MIN} y={MIN} width={SPAN} height={SPAN} rx={0.25} />
      <g class="grid">{lines}</g>
      {STAR.map((i) => {
        const [x, y] = toXY(i);
        return <circle key={`star${i}`} class="star" cx={x} cy={y} r={0.09} />;
      })}
      <g class="labels">{labels}</g>
      {stones}
      {area?.map((owner, i) => {
        if (!owner || (board[i] && !dim?.includes(i))) return null;
        const [x, y] = toXY(i);
        return <rect key={`a${i}`} class={`area ${owner === 'B' ? 'black' : 'white'}`} x={x - 0.17} y={y - 0.17} width={0.34} height={0.34} />;
      })}
      {targets
        .filter((i) => board[i])
        .map((i) => {
          const [x, y] = toXY(i);
          return (
            <polygon
              key={`t${i}`}
              class={`mark ${markFor(i)}`}
              points={`${x},${y - 0.22} ${x - 0.2},${y + 0.14} ${x + 0.2},${y + 0.14}`}
            />
          );
        })}
      {lastMove !== null && board[lastMove] && (
        <circle class={`last ${markFor(lastMove)}`} cx={toXY(lastMove)[0]} cy={toXY(lastMove)[1]} r={0.17} />
      )}
      {ring && (
        <circle class={`ring ${ring.kind}`} cx={toXY(ring.point)[0]} cy={toXY(ring.point)[1]} r={0.56} />
      )}
      {ghost !== null && !board[ghost] && (
        <circle class={`stone ghost ${toPlay === 'B' ? 'black' : 'white'}`} cx={toXY(ghost)[0]} cy={toXY(ghost)[1]} r={0.47} />
      )}
    </svg>
  );
}
