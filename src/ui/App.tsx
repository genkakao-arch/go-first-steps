import { lazy, Suspense } from 'preact/compat';
import { useEffect, useState } from 'preact/hooks';
import { PROBLEMS, PROBLEM_IDS, TOPIC_IDS, indexOf, topicById, topicEntry } from '../course';
import type { TopicId } from '../data/types';
import { type Progress, emptyProgress, loadCloud, loadLocal, problemState, save } from '../progress';
import { inTelegram, setBackButton } from '../telegram';
import { Home } from './Home';
import { ProblemView, type AttemptKind } from './ProblemView';

const KataGoLab = lazy(() => import('./KataGoLab').then((m) => ({ default: m.KataGoLab })));
const GameView = lazy(() => import('./GameView').then((m) => ({ default: m.GameView })));

type Screen = { name: 'home' } | { name: 'katago' } | { name: 'play' } | { name: 'intro'; topic: TopicId; then: string } | { name: 'problem'; id: string };

const initial = loadLocal(PROBLEM_IDS, TOPIC_IDS);

export function App() {
  const [progress, setProgress] = useState<Progress>(initial.progress);
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [notice, setNotice] = useState<string | null>(
    initial.recovered ? 'Сохранённые данные оказались повреждены, поэтому прогресс начат заново.' : null,
  );

  // A newer copy in Telegram CloudStorage wins (e.g. local WebView storage was cleared).
  useEffect(() => {
    let alive = true;
    void loadCloud(PROBLEM_IDS, TOPIC_IDS).then((cloud) => {
      if (!alive || !cloud) return;
      setProgress((local) => {
        if (cloud.updatedAt <= local.updatedAt) return local;
        save(cloud);
        return cloud;
      });
    });
    return () => {
      alive = false;
    };
  }, []);

  const update = (fn: (p: Progress) => Progress) =>
    setProgress((prev) => {
      const next = { ...fn(prev), updatedAt: Date.now() };
      save(next);
      return next;
    });

  const goHome = () => setScreen({ name: 'home' });

  useEffect(() => (screen.name === 'home' ? setBackButton(null) : setBackButton(goHome)), [screen.name]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [screen]);

  const open = (id: string) => {
    const topic = PROBLEMS[indexOf(id)]!.topic;
    if (!progress.introsSeen.includes(topic)) setScreen({ name: 'intro', topic, then: id });
    else setScreen({ name: 'problem', id });
    update((p) => (indexOf(id) > indexOf(p.current) ? { ...p, current: id } : p));
  };

  const patchProblem = (id: string, fn: (s: ReturnType<typeof problemState>) => Partial<ReturnType<typeof problemState>>) =>
    update((p) => {
      const cur = problemState(p, id);
      return { ...p, problems: { ...p.problems, [id]: { ...cur, ...fn(cur) } } };
    });

  const advanceFrom = (id: string) =>
    update((p) => {
      const i = indexOf(id);
      const next = PROBLEMS[i + 1];
      return next && i >= indexOf(p.current) ? { ...p, current: next.id } : p;
    });

  let body;
  if (screen.name === 'home') {
    body = (
      <Home
        progress={progress}
        notice={notice}
        onOpen={(id) => {
          setNotice(null);
          open(id);
        }}
        onOpenTopic={(t) => {
          setNotice(null);
          open(topicEntry(progress, t));
        }}
        onReplace={(p) => update(() => p)}
        onReset={() => update(() => emptyProgress(PROBLEM_IDS[0]!))}
        onKataGo={() => setScreen({ name: 'play' })}
      />
    );
  } else if (screen.name === 'play') {
    body = (
      <Suspense fallback={<p class="muted">Загрузка…</p>}>
        <GameView onSpeedTest={() => setScreen({ name: 'katago' })} />
      </Suspense>
    );
  } else if (screen.name === 'katago') {
    body = (
      <Suspense fallback={<p class="muted">Загрузка…</p>}>
        <KataGoLab />
      </Suspense>
    );
  } else if (screen.name === 'intro') {
    const t = topicById(screen.topic);
    const then = screen.then;
    body = (
      <div class="intro">
        <p class="muted">Новая тема</p>
        <h1>{t.title}</h1>
        <ul>
          {t.intro.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
        <div class="actions">
          <button
            class="primary wide"
            onClick={() => {
              update((p) => (p.introsSeen.includes(t.id) ? p : { ...p, introsSeen: [...p.introsSeen, t.id] }));
              setScreen({ name: 'problem', id: then });
            }}
          >
            Понятно, к задачам
          </button>
        </div>
      </div>
    );
  } else {
    const p = PROBLEMS[indexOf(screen.id)]!;
    const i = indexOf(p.id);
    const next = PROBLEMS[i + 1];
    body = (
      <ProblemView
        key={p.id}
        problem={p}
        number={i + 1}
        total={PROBLEMS.length}
        topicTitle={topicById(p.topic).title}
        state={problemState(progress, p.id)}
        hasNext={!!next}
        onAttempt={(kind: AttemptKind) => {
          patchProblem(p.id, (s) => ({ attempts: s.attempts + 1, solved: s.solved || kind === 'correct' }));
          if (kind === 'correct') advanceFrom(p.id);
        }}
        onHint={() => patchProblem(p.id, (s) => ({ hints: s.hints + 1 }))}
        onReveal={() => {
          patchProblem(p.id, () => ({ revealed: true }));
          advanceFrom(p.id);
        }}
        onNext={() => (next ? open(next.id) : goHome())}
        onTheory={() => setScreen({ name: 'intro', topic: p.topic, then: p.id })}
      />
    );
  }

  return (
    <main class="app">
      {!inTelegram() && screen.name !== 'home' && (
        <button class="back" onClick={goHome}>
          ← К темам
        </button>
      )}
      {body}
    </main>
  );
}
