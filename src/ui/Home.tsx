import { useState } from 'preact/hooks';
import type { TopicId } from '../data/types';
import { PROBLEMS, TOPICS, continueTarget, indexOf, isOpen, isTopicOpen, problemsOf, solvedCount, topicById } from '../course';
import { type Progress, problemState } from '../progress';
import { DataPanel } from './DataPanel';

interface Props {
  progress: Progress;
  notice: string | null;
  onOpen: (id: string) => void;
  onOpenTopic: (topic: TopicId) => void;
  onReplace: (p: Progress) => void;
  onReset: () => void;
}

export function Home({ progress, notice, onOpen, onOpenTopic, onReplace, onReset }: Props) {
  const [showAll, setShowAll] = useState(false);
  const solved = solvedCount(progress);
  const target = continueTarget(progress);
  const targetProblem = PROBLEMS[indexOf(target)]!;
  const started = Object.keys(progress.problems).length > 0;
  const pct = Math.round((solved / PROBLEMS.length) * 100);

  return (
    <div class="home">
      <header class="home-head">
        <h1>Го: первые шаги</h1>
        <p class="muted">Короткие задачи на доске 9×9</p>
      </header>

      {notice && <p class="notice">{notice}</p>}

      <section class="card hero">
        <div class="progress-line">
          <span class="big">
            {solved} / {PROBLEMS.length}
          </span>
          <span class="muted">решено</span>
        </div>
        <div class="bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div style={{ width: `${pct}%` }} />
        </div>
        <p class="current-topic">
          <span class="muted">Тема: </span>
          {topicById(targetProblem.topic).title}
        </p>
        <button class="primary wide" onClick={() => onOpen(target)}>
          {started ? 'Продолжить' : 'Начать обучение'}
        </button>
      </section>

      <section class="card">
        <h2>Темы</h2>
        <ul class="topics">
          {TOPICS.map((t, ti) => {
            const list = problemsOf(t.id);
            const open = isTopicOpen(progress, t.id);
            const done = solvedCount(progress, list);
            return (
              <li key={t.id}>
                <button class="topic" disabled={!open} onClick={() => onOpenTopic(t.id)}>
                  <span class="topic-n">{ti + 1}</span>
                  <span class="topic-title">{t.title}</span>
                  <span class="topic-count">{open ? `${done}/${list.length}` : '🔒'}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section class="card">
        <button class="section-toggle" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
          <h2>Все задачи</h2>
          <span class="muted">{showAll ? 'Скрыть' : 'Показать'}</span>
        </button>
        {showAll && (
          <>
            <div class="grid">
              {PROBLEMS.map((p, i) => {
                const st = problemState(progress, p.id);
                const open = isOpen(progress, i);
                const cls = st.solved
                  ? st.hints > 0 || st.revealed
                    ? 'solved helped'
                    : 'solved'
                  : st.revealed
                    ? 'revealed'
                    : st.attempts > 0
                      ? 'tried'
                      : open
                        ? 'open'
                        : 'locked';
                return (
                  <button
                    key={p.id}
                    class={`cell ${cls}`}
                    disabled={!open}
                    onClick={() => onOpen(p.id)}
                    aria-label={`Задача ${i + 1}: ${p.title}`}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </div>
            <ul class="legend muted small">
              <li>
                <span class="cell solved" /> решена сразу
              </li>
              <li>
                <span class="cell solved helped" /> решена с подсказкой
              </li>
              <li>
                <span class="cell revealed" /> смотрел решение
              </li>
              <li>
                <span class="cell tried" /> были попытки
              </li>
            </ul>
          </>
        )}
      </section>

      <DataPanel progress={progress} onReplace={onReplace} onReset={onReset} />
    </div>
  );
}
