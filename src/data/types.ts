import type { Color } from '../go/board';

export type TopicId =
  | 'liberties'
  | 'atari'
  | 'escape'
  | 'connect'
  | 'cut'
  | 'chase'
  | 'life'
  | 'territory'
  | 'practice';

export interface Topic {
  id: TopicId;
  title: string;
  /** Short lesson shown before the first problem of the topic. New terms are introduced here. */
  intro: string[];
  /** Terms this topic introduces (used by the content checker). */
  terms: string[];
}

/** What the correct move must achieve. Used for feedback and automatic validation. */
export type Goal =
  | { type: 'capture'; targets: string[]; read?: boolean }
  | { type: 'atari'; target: string }
  | { type: 'double-atari'; targets: [string, string] }
  | { type: 'escape'; target: string }
  | { type: 'connect'; stones: string[] }
  | { type: 'cut'; stones: [string, string] }
  | { type: 'live'; target: string }
  | { type: 'kill'; target: string }
  | { type: 'enclose'; point: string };

/** Facts that must hold after the move (and its reply sequence). Checked by the validator. */
export type Assertion =
  | { libs: string; n: number }
  | { captured: string[] }
  | { same: string[] }
  | { apart: string[] }
  | { empty: string[] };

export interface Answer {
  move: string;
  /** Explanation for this particular move; for solutions it defaults to the problem explanation. */
  text?: string;
  /** Continuation shown after the move: opponent, then us, then opponent… */
  reply?: string[];
  check?: Assertion[];
}

export interface Problem {
  id: string;
  topic: TopicId;
  title: string;
  prompt: string;
  toPlay: Color;
  /** Space-separated coordinates of black / white stones, e.g. "C3 D4". */
  black: string;
  white: string;
  goal: Goal;
  /** Stones to mark with a triangle (what the problem is about). */
  marks?: string[];
  solutions: Answer[];
  /** Moves that work but are explicitly worse than the solution ("Можно лучше"). */
  better?: Answer[];
  /** Common mistakes with a specific explanation. */
  wrong?: Answer[];
  hints: string[];
  explanation: string;
  /** Id of a problem with the same shape seen from the other side (intentional near-duplicate). */
  pair?: string;
}
