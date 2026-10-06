import { expect, test, type Page } from '@playwright/test';

const COLS = 'ABCDEFGHJ';
// Must match the viewBox in src/ui/Board.tsx.
const VB = { x: -0.95, y: -0.95, w: 9.9, h: 9.9 };

async function pointPx(page: Page, name: string, dx = 0, dy = 0) {
  await page.locator('svg.board').scrollIntoViewIfNeeded();
  const box = (await page.locator('svg.board').boundingBox())!;
  const x = COLS.indexOf(name[0]!);
  const y = 9 - Number(name.slice(1));
  return {
    x: box.x + ((x + dx - VB.x) / VB.w) * box.width,
    y: box.y + ((y + dy - VB.y) / VB.h) * box.height,
  };
}

async function tapPoint(page: Page, name: string, dx = 0, dy = 0) {
  const p = await pointPx(page, name, dx, dy);
  await page.mouse.click(p.x, p.y);
}

async function ringAt(page: Page) {
  const r = page.locator('circle.ring');
  return { cx: Number(await r.getAttribute('cx')), cy: Number(await r.getAttribute('cy')) };
}

async function noHorizontalScroll(page: Page) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw).toBeLessThanOrEqual(cw);
}

test.beforeEach(async ({ page }) => {
  // The Telegram script is external; tests exercise the plain-browser mode.
  await page.route('https://telegram.org/**', (r) => r.abort());
});

test('full learner journey with persistence', async ({ page }, info) => {
  await page.goto('./');
  await expect(page.getByText('0 / 100')).toBeVisible();
  await noHorizontalScroll(page);
  await page.screenshot({ path: info.outputPath('home.png') });

  await page.getByRole('button', { name: 'Начать обучение' }).click();
  await expect(page.getByRole('heading', { name: 'Свободы и захват' })).toBeVisible();
  await page.getByRole('button', { name: 'Понятно, к задачам' }).click();

  // Problem 1: board fits the width, wrong move first.
  await expect(page.getByRole('heading', { name: /Последняя свобода/ })).toBeVisible();
  const board = (await page.locator('svg.board').boundingBox())!;
  const vw = page.viewportSize()!.width;
  expect(board.x).toBeGreaterThanOrEqual(0);
  expect(board.x + board.width).toBeLessThanOrEqual(vw);
  expect(board.width).toBeGreaterThan(vw * 0.75);
  await noHorizontalScroll(page);
  await page.screenshot({ path: info.outputPath('problem.png') });

  await tapPoint(page, 'A9');
  await expect(page.locator('.feedback.wrong h3')).toHaveText('Попробуй ещё');
  await expect(page.locator('.feedback.wrong')).toContainText('Захвата нет');
  // Solution must not be offered after the first mistake.
  await expect(page.getByRole('button', { name: 'Показать решение' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Попробовать ещё' }).click();

  // Occupied point: explained, not counted.
  await tapPoint(page, 'E5');
  await expect(page.locator('.toast')).toContainText('занята');

  await page.getByRole('button', { name: /Подсказка 1\/2/ }).click();
  await expect(page.locator('.hints')).toContainText('Подсказка 1');

  await tapPoint(page, 'E4');
  await expect(page.locator('.feedback.correct h3')).toHaveText('Правильно');
  await expect(page.locator('.feedback.correct')).toContainText('E4');
  await page.getByRole('button', { name: 'Следующая задача' }).click();

  // Problem 2: three wrong moves unlock the solution.
  await expect(page.getByRole('heading', { name: /Камень на краю/ })).toBeVisible();
  for (let i = 0; i < 3; i++) {
    await tapPoint(page, ['A9', 'B9', 'C9'][i]!);
    await expect(page.locator('.feedback.wrong')).toBeVisible();
    await page.getByRole('button', { name: 'Попробовать ещё' }).click();
  }
  await page.getByRole('button', { name: 'Показать решение' }).click();
  await expect(page.locator('.feedback.solution h3')).toHaveText('Решение: F1');
  expect(await ringAt(page)).toEqual({ cx: 5, cy: 8 });
  await page.getByRole('button', { name: 'Следующая задача' }).click();
  await expect(page.getByRole('heading', { name: /Камень в углу/ })).toBeVisible();

  // Close and reopen: progress survives.
  await page.reload();
  await expect(page.getByText('1 / 100')).toBeVisible();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await expect(page.getByRole('heading', { name: /Камень в углу/ })).toBeVisible();
});

test('taps near edges and corners hit the right intersection', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Начать обучение' }).click();
  await page.getByRole('button', { name: 'Понятно, к задачам' }).click();
  // Taps slightly outside the grid (in the margin) and slightly off the point.
  const cases: [string, number, number, number, number][] = [
    ['A9', -0.4, -0.35, 0, 0],
    ['J9', 0.4, -0.35, 8, 0],
    ['A1', -0.4, 0.4, 0, 8],
    ['J1', 0.45, 0.45, 8, 8],
    ['C3', 0.3, -0.3, 2, 6],
  ];
  for (const [pt, dx, dy, cx, cy] of cases) {
    await tapPoint(page, pt, dx, dy);
    expect(await ringAt(page), pt).toEqual({ cx, cy });
    await page.getByRole('button', { name: 'Попробовать ещё' }).click();
  }
});

test('corrupted storage does not break the app; export/import/reset work', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.setItem('go-trainer-progress', '{"v":1,"problems":'));
  await page.reload();
  await expect(page.locator('.notice')).toContainText('повреждены');
  await expect(page.getByText('0 / 100')).toBeVisible();

  const data = { v: 1, current: 'lib-04', problems: { 'lib-01': { solved: true, attempts: 1, hints: 0, revealed: false }, 'lib-02': { solved: true, attempts: 2, hints: 1, revealed: false }, 'lib-03': { solved: true, attempts: 1, hints: 0, revealed: false }, bogus: { solved: true } }, introsSeen: ['liberties'], updatedAt: 1 };
  await page.getByRole('button', { name: 'Импорт' }).click();
  await page.getByPlaceholder('Вставь сюда текст экспорта').fill(JSON.stringify(data));
  await page.getByRole('button', { name: /Загрузить/ }).click();
  await expect(page.getByText('3 / 100')).toBeVisible();

  await page.getByRole('button', { name: 'Экспорт' }).click();
  const exported = await page.locator('.data-body textarea').inputValue();
  expect(JSON.parse(exported).problems.bogus).toBeUndefined();
  expect(JSON.parse(exported).current).toBe('lib-04');

  await page.getByRole('button', { name: 'Импорт' }).click();
  await page.getByPlaceholder('Вставь сюда текст экспорта').fill('not json');
  await page.getByRole('button', { name: /Загрузить/ }).click();
  await expect(page.getByRole('status')).toContainText('Не получилось');

  await page.getByRole('button', { name: 'Сброс' }).click();
  await page.getByRole('button', { name: 'Да, сбросить прогресс' }).click();
  await expect(page.getByText('0 / 100')).toBeVisible();
  await page.reload();
  await expect(page.getByText('0 / 100')).toBeVisible();
});

test('dark theme renders', async ({ page }, info) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('./');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(23, 25, 28)');
  await page.getByRole('button', { name: 'Начать обучение' }).click();
  await page.getByRole('button', { name: 'Понятно, к задачам' }).click();
  await tapPoint(page, 'E4');
  await page.screenshot({ path: info.outputPath('dark.png') });
  await noHorizontalScroll(page);
});

test('installable PWA that works offline', async ({ page, context }) => {
  await page.goto('./');
  const manifest = await page.evaluate(async () => {
    const href = document.querySelector('link[rel="manifest"]')?.getAttribute('href');
    return href ? (await fetch(href)).json() : null;
  });
  expect(manifest?.display).toBe('standalone');
  expect(manifest?.icons?.length).toBeGreaterThanOrEqual(2);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect(page.locator('.install')).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText('/ 100')).toBeVisible();
  await page.getByRole('button', { name: 'Начать обучение' }).click();
  await expect(page.getByRole('heading', { name: 'Свободы и захват' })).toBeVisible();
  await context.setOffline(false);
});

test('game against KataGo: move, coach, persistence, resign', async ({ page }, info) => {
  test.setTimeout(180_000);
  await page.goto('./');
  await page.getByRole('button', { name: 'Играть', exact: true }).click();
  await expect(page.getByText('Твой ход: ты играешь чёрными.')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('уровень 3')).toBeVisible();

  await tapPoint(page, 'E5');
  await expect(page.getByText('Твой ход.', { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('circle.stone.white')).toHaveCount(1);
  await expect(page.locator('circle.stone.black')).toHaveCount(1);

  // Both moves are explained; KataGo's plan can be stepped through on the board.
  await expect(page.locator('.feedback h3', { hasText: 'Твой ход E5' }).or(page.locator('.feedback.wrong, .feedback.better').first())).toBeVisible();
  const whiteNote = page.locator('.feedback', { hasText: 'Белые:' });
  await expect(whiteNote).toBeVisible();
  await expect(whiteNote).not.toContainText('Разбираю ход', { timeout: 60_000 });
  await page.getByRole('button', { name: /Чего хотят белые/ }).click();
  await expect(page.getByText(/Чего хотят белые: ход \d+ из \d+/)).toBeVisible();
  await expect(page.locator('text.stone-label').first()).toBeVisible();
  await page.screenshot({ path: info.outputPath('variation.png'), fullPage: true });
  await page.getByRole('button', { name: '◀ Назад' }).click();
  await page.getByRole('button', { name: 'Вернуться к партии' }).click();
  await expect(page.locator('text.stone-label')).toHaveCount(0);

  await page.getByRole('button', { name: 'Что здесь происходит?' }).click();
  await expect(page.locator('.hints')).toContainText('KataGo');
  await page.getByRole('button', { name: 'Показать территорию' }).click();
  await expect(page.locator('rect.area').first()).toBeVisible();
  await page.screenshot({ path: info.outputPath('game.png'), fullPage: true });
  await noHorizontalScroll(page);

  // Closing and reopening keeps the unfinished game.
  await page.reload();
  await page.getByRole('button', { name: 'Играть', exact: true }).click();
  await expect(page.getByText('Твой ход.', { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('circle.stone.white')).toHaveCount(1);

  // "Новая партия" mid-game asks first and does not count the game.
  await page.getByRole('button', { name: 'Новая партия' }).click();
  await page.getByRole('button', { name: /Начать заново/ }).click();
  await expect(page.locator('circle.stone')).toHaveCount(0);
  await expect(page.getByText('уровень 3 · партий 0, побед 0')).toBeVisible();
  await tapPoint(page, 'E5');
  await expect(page.getByText('Твой ход.', { exact: true })).toBeVisible({ timeout: 60_000 });

  await page.getByRole('button', { name: 'Сдаться' }).click();
  await page.getByRole('button', { name: 'Точно сдаться?' }).click();
  await expect(page.getByRole('heading', { name: 'Поражение' })).toBeVisible();
  await expect(page.getByText('KataGo станет слабее: уровень 2.')).toBeVisible();
  await page.getByRole('button', { name: 'Новая партия' }).click();
  await expect(page.getByText('уровень 2 · партий 1, побед 0')).toBeVisible();
  await expect(page.locator('circle.stone')).toHaveCount(0);
});

test('KataGo speed test page works', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('./');
  await page.getByRole('button', { name: 'Играть', exact: true }).click();
  await page.getByRole('button', { name: 'Проверка скорости' }).click();
  await expect(page.getByText('Ускорение:')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Замерить скорость' }).click();
  await expect(page.getByText(/одна оценка позиции/)).toBeVisible({ timeout: 60_000 });
});
