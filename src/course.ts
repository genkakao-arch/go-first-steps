import { PROBLEMS } from './data/problems';
import { TOPICS } from './data/topics';
import type { Problem, Topic, TopicId } from './data/types';
import { type Progress, problemState } from './progress';

export { PROBLEMS, TOPICS };

export const PROBLEM_IDS = PROBLEMS.map((p) => p.id);
export const TOPIC_IDS = TOPICS.map((t) => t.id);

const indexById = new Map(PROBLEMS.map((p, i) => [p.id, i]));

export function indexOf(id: string): number {
  return indexById.get(id) ?? 0;
}

export function topicById(id: TopicId): Topic {
  return TOPICS.find((t) => t.id === id)!;
}

export function problemsOf(topic: TopicId): Problem[] {
  return PROBLEMS.filter((p) => p.topic === topic);
}

/** Furthest problem the learner has reached (everything up to it is open). */
export function frontier(p: Progress): number {
  let max = indexOf(p.current);
  for (const [id, st] of Object.entries(p.problems)) {
    if (st.solved || st.revealed) max = Math.max(max, Math.min(indexOf(id) + 1, PROBLEMS.length - 1));
    else if (st.attempts > 0) max = Math.max(max, indexOf(id));
  }
  return max;
}

export function isOpen(p: Progress, index: number): boolean {
  return index <= frontier(p);
}

export function isTopicOpen(p: Progress, topic: TopicId): boolean {
  const first = PROBLEMS.findIndex((x) => x.topic === topic);
  return first >= 0 && isOpen(p, first);
}

export function solvedCount(p: Progress, list: Problem[] = PROBLEMS): number {
  return list.filter((x) => problemState(p, x.id).solved).length;
}

/** Where "Продолжить" leads: the current problem, or the first unsolved one if everything else is done. */
export function continueTarget(p: Progress): string {
  const cur = problemState(p, p.current);
  if (!cur.solved && !cur.revealed) return p.current;
  const next = PROBLEMS.find((x, i) => i > indexOf(p.current) && !problemState(p, x.id).solved);
  if (next) return next.id;
  const anyUnsolved = PROBLEMS.find((x) => !problemState(p, x.id).solved);
  return anyUnsolved?.id ?? p.current;
}

/** Problem to open when a topic is picked: its first unsolved problem that is open, else its first. */
export function topicEntry(p: Progress, topic: TopicId): string {
  const list = problemsOf(topic);
  const target = list.find((x) => !problemState(p, x.id).solved && isOpen(p, indexOf(x.id)));
  return (target ?? list[0]!).id;
}
