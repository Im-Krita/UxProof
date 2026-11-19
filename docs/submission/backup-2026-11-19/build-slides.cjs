const PptxGenJS = require('pptxgenjs');
const path = require('path');

const pres = new PptxGenJS();
pres.layout = 'LAYOUT_WIDE';
pres.author = 'UXProof';
pres.title = 'UXProof: аудит шагов в Chromium';

const BG = 'F7F8FA';
const INK = '202C38';
const MUTED = '5E6C79';
const GREEN = '213E33';
const PALE = 'C4F0D2';
const CARD = 'FFFFFF';
const LINE = 'E6E9ED';
const WARN = '8A3B2B';

function blank(title) {
  const s = pres.addSlide();
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 13.33, h: 7.5, fill: { color: BG } });
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 0.12, h: 7.5, fill: { color: GREEN } });
  if (title) {
    s.addText(title, {
      x: 0.55, y: 0.28, w: 12.2, h: 0.7,
      fontFace: 'Segoe UI', fontSize: 26, bold: true, color: INK, margin: 0,
    });
  }
  return s;
}

{
  const s = pres.addSlide();
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 13.33, h: 7.5, fill: { color: GREEN } });
  s.addText('UXProof', {
    x: 0.7, y: 2.0, w: 12, h: 0.7,
    fontFace: 'Segoe UI', fontSize: 18, color: PALE, margin: 0,
  });
  s.addText('Проверяет, проходит ли пользовательский шаг в Chromium', {
    x: 0.7, y: 2.7, w: 12, h: 1.4,
    fontFace: 'Segoe UI', fontSize: 32, bold: true, color: 'FFFFFF', margin: 0,
  });
  s.addText('Windows · Tauri 2 · Playwright · axe-core · опциональный ИИ\nСрез 19 ноября 2026, ветка core-roadmap', {
    x: 0.7, y: 4.5, w: 12, h: 1.1,
    fontFace: 'Segoe UI', fontSize: 16, color: PALE, margin: 0,
  });
  s.addNotes('Титул. Не говорить «не оценка красоты». Прямое утверждение.');
}

{
  const s = blank('Что ломается на Relay');
  const items = [
    ['Сохранение', 'Кнопка есть, узла role=status нет. Пользователь не видит, что профиль записан.'],
    ['«На главную»', 'На узком экране ссылка прячется. Шаг click падает по таймауту 5,5 с.'],
    ['Настройки', 'Сценарий ловит JavaScript pageerror и горизонтальный overflow.'],
  ];
  items.forEach((row, i) => {
    const y = 1.2 + i * 1.85;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: 0.55, y, w: 12.2, h: 1.7, fill: { color: CARD }, rectRadius: 0.08,
      shadow: { type: 'outer', color: '202C38', blur: 8, offset: 2, opacity: 0.06 },
    });
    s.addText(row[0], {
      x: 0.8, y: y + 0.18, w: 11.7, h: 0.4,
      fontFace: 'Segoe UI', fontSize: 18, bold: true, color: GREEN, margin: 0,
    });
    s.addText(row[1], {
      x: 0.8, y: y + 0.62, w: 11.7, h: 0.85,
      fontFace: 'Segoe UI', fontSize: 16, color: INK, margin: 0,
    });
  });
}

{
  const s = blank('Сценарий × три экрана, два класса находок');
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 0.55, y: 1.2, w: 6.0, h: 5.5, fill: { color: CARD }, rectRadius: 0.08,
  });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 6.8, y: 1.2, w: 6.0, h: 5.5, fill: { color: CARD }, rectRadius: 0.08,
  });
  s.addText('confirmed', {
    x: 0.8, y: 1.45, w: 5.5, h: 0.45, fontFace: 'Segoe UI', fontSize: 20, bold: true, color: GREEN, margin: 0,
  });
  s.addText('Упавший шаг Playwright, правило axe, overflow, pageerror. Есть шаг, экран, PNG.', {
    x: 0.8, y: 2.05, w: 5.5, h: 2.2, fontFace: 'Segoe UI', fontSize: 18, color: INK, margin: 0,
  });
  s.addText('recommendation', {
    x: 7.05, y: 1.45, w: 5.5, h: 0.45, fontFace: 'Segoe UI', fontSize: 20, bold: true, color: MUTED, margin: 0,
  });
  s.addText('До трёх гипотез модели по скриншоту. Не доказательство. ИИ выключен по умолчанию.', {
    x: 7.05, y: 2.05, w: 5.5, h: 2.2, fontFace: 'Segoe UI', fontSize: 18, color: INK, margin: 0,
  });
  s.addText('Отчёт: JSON, HTML, Excel. План шагов из текста проходит validateConfig и ждёт кнопку.', {
    x: 0.8, y: 4.6, w: 11.7, h: 1.5, fontFace: 'Segoe UI', fontSize: 16, color: MUTED, margin: 0,
  });
}

{
  const s = blank('Окно → Rust → Node → Chromium');
  const steps = [
    ['UI', 'React. Сценарии, viewport, запуск.'],
    ['Rust', 'IPC, URL, lock, spawn bundled Node.'],
    ['Runner', 'Playwright, axe, PNG, Excel.'],
    ['Сайт', 'Только http(s). Relay на :4180.'],
  ];
  steps.forEach((row, i) => {
    const x = 0.55 + i * 3.15;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x, y: 1.5, w: 2.95, h: 4.6, fill: { color: CARD }, rectRadius: 0.08,
    });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: x + 0.25, y: 1.8, w: 2.45, h: 0.7, fill: { color: GREEN }, rectRadius: 0.06,
    });
    s.addText(String(i + 1), {
      x: x + 0.25, y: 1.88, w: 2.45, h: 0.55,
      fontFace: 'Segoe UI', fontSize: 18, bold: true, color: PALE, align: 'center', margin: 0,
    });
    s.addText(row[0], {
      x: x + 0.2, y: 2.7, w: 2.55, h: 0.6,
      fontFace: 'Segoe UI', fontSize: 20, bold: true, color: INK, margin: 0,
    });
    s.addText(row[1], {
      x: x + 0.2, y: 3.4, w: 2.55, h: 2.2,
      fontFace: 'Segoe UI', fontSize: 16, color: MUTED, margin: 0,
    });
  });
}

{
  const s = blank('Relay: два URL, разные итоги');
  const rows = [
    [
      { text: 'Адрес', options: { bold: true, fill: { color: GREEN }, color: 'FFFFFF' } },
      { text: 'Сценарии × экран', options: { bold: true, fill: { color: GREEN }, color: 'FFFFFF' } },
      { text: 'axe в этом прогоне', options: { bold: true, fill: { color: GREEN }, color: 'FFFFFF' } },
    ],
    ['http://127.0.0.1:4180/', 'smoke 5/9', 'есть color-contrast'],
    ['http://127.0.0.1:4180/fixed', 'test:fix 9/9', '0 замечаний axe'],
  ];
  s.addTable(rows, {
    x: 0.55, y: 1.3, w: 12.2, h: 2.6,
    colW: [4.6, 3.8, 3.8],
    border: [{ pt: 1, color: LINE }, { pt: 1, color: LINE }, { pt: 1, color: LINE }, { pt: 1, color: LINE }],
    fontFace: 'Segoe UI', fontSize: 15, color: INK,
    valign: 'middle',
  });
  s.addText('qa:ipc в release-окне на /fixed: 9/9 сценариев. В журнале UI могут остаться confirmed находки, которые не ломают шаг (copy-правила). Не обещать «ноль дефектов в интерфейсе».', {
    x: 0.55, y: 4.2, w: 12.2, h: 2.2,
    fontFace: 'Segoe UI', fontSize: 16, color: INK, margin: 0,
  });
}

{
  const s = blank('Доказательство шага');
  const cards = [
    ['PNG', 'Отдельный снимок упавшего шага. Конечный PNG прогона хранится отдельно.'],
    ['JSON / HTML / Excel', 'Один прогон, три выгрузки. MCP list_reports без картинок.'],
    ['Сравнение', 'resolved только у ошибки шага, если все прежние комбинации прошли.'],
  ];
  cards.forEach((row, i) => {
    const y = 1.25 + i * 1.85;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: 0.55, y, w: 12.2, h: 1.7, fill: { color: CARD }, rectRadius: 0.08,
    });
    s.addText(row[0], {
      x: 0.85, y: y + 0.22, w: 11.6, h: 0.4,
      fontFace: 'Segoe UI', fontSize: 18, bold: true, color: GREEN, margin: 0,
    });
    s.addText(row[1], {
      x: 0.85, y: y + 0.7, w: 11.6, h: 0.7,
      fontFace: 'Segoe UI', fontSize: 16, color: INK, margin: 0,
    });
  });
}

{
  const s = blank('Модель предлагает, человек подтверждает');
  s.addText('Vision: UXPROOF_OLLAMA_MODEL (дефолт llava). QA: qwen2.5vl:3b. OpenAI gpt-4.1-mini в коде, живой платный вызов не делали.', {
    x: 0.55, y: 1.25, w: 12.2, h: 1.3, fontFace: 'Segoe UI', fontSize: 16, color: INK, margin: 0,
  });
  s.addText('Planner на Ollama читает ту же UXPROOF_OLLAMA_MODEL (дефолт llama3.1). qa:ollama на время плана ставит qwen2.5:3b. UXPROOF_PLANNER_MODEL только для OpenAI.', {
    x: 0.55, y: 2.6, w: 12.2, h: 1.4, fontFace: 'Segoe UI', fontSize: 16, color: INK, margin: 0,
  });
  s.addText('Класс только recommendation. Не больше трёх замечаний. Ollama только localhost. moondream и llama3.2:1b на стенде ломались.', {
    x: 0.55, y: 4.15, w: 12.2, h: 1.3, fontFace: 'Segoe UI', fontSize: 16, color: INK, margin: 0,
  });
  s.addText('ИИ выключен по умолчанию. Аудит без ключа проходит.', {
    x: 0.55, y: 5.55, w: 12.2, h: 0.7, fontFace: 'Segoe UI', fontSize: 18, bold: true, color: GREEN, margin: 0,
  });
}

{
  const s = blank('Срез 19 ноября 2026');
  const lines = [
    '128 runner-тестов: 127 pass, 1 skip (Python cryptography).',
    'cargo test 19/19, включая Job Object.',
    'Ollama живой (qa:ollama). Платный OpenAI нет.',
    'MSI на mono: Node в PATH пуст, WebView2 уже стоял.',
    'Образ без WebView2 не ставили. GitHub CI глазами не смотрели.',
  ];
  lines.forEach((t, i) => {
    const y = 1.25 + i * 1.05;
    s.addShape(pres.shapes.OVAL, { x: 0.65, y: y + 0.18, w: 0.22, h: 0.22, fill: { color: GREEN } });
    s.addText(t, {
      x: 1.1, y, w: 11.5, h: 0.9,
      fontFace: 'Segoe UI', fontSize: 18, color: INK, margin: 0, valign: 'middle',
    });
  });
}

{
  const s = blank('Какой вопрос закрывает инструмент');
  const rows = [
    [
      { text: 'Инструмент', options: { bold: true, fill: { color: GREEN }, color: 'FFFFFF' } },
      { text: 'Вопрос', options: { bold: true, fill: { color: GREEN }, color: 'FFFFFF' } },
    ],
    ['Playwright Test / Cypress', 'Код-тест. Отчёт для разработчика.'],
    ['Lighthouse / axe DevTools', 'Страница и WCAG-теги, без сценария сохранения.'],
    ['Percy / Applitools', 'Экран изменился. Не факт клика.'],
    ['Скрин в ChatGPT', 'Гипотеза. Шаг не исполнен.'],
    ['UXProof', 'Сценарий в UI, PNG шага, confirmed отдельно от recommendation.'],
  ];
  s.addTable(rows, {
    x: 0.55, y: 1.2, w: 12.2, h: 5.5,
    colW: [4.4, 7.8],
    border: [{ pt: 1, color: LINE }, { pt: 1, color: LINE }, { pt: 1, color: LINE }, { pt: 1, color: LINE }],
    fontFace: 'Segoe UI', fontSize: 14, color: INK,
    valign: 'middle',
  });
}

{
  const s = blank('Как открыть');
  s.addText('Код: github.com/Narut0-1488/UXProof  ·  ветка core-roadmap\nРепозиторий не запускает окно сам.', {
    x: 0.55, y: 1.25, w: 12.2, h: 1.2, fontFace: 'Segoe UI', fontSize: 18, color: INK, margin: 0,
  });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 0.55, y: 2.6, w: 12.2, h: 3.9, fill: { color: CARD }, rectRadius: 0.08,
  });
  s.addText('Windows, два терминала:\n1. npm run demo     →  http://127.0.0.1:4180  и  /fixed\n2. npm run tauri    или  npm run dev (браузер :1420)\n\nИли MSI с машины. GitHub Pages в этот комплект не входит: /fixed без demo/server.mjs даёт 404.', {
    x: 0.85, y: 2.85, w: 11.6, h: 3.4, fontFace: 'Consolas', fontSize: 16, color: INK, margin: 0,
  });
}

const out = path.join(__dirname, '02-prezentatsiya.pptx');
pres.writeFile({ fileName: out }).then(() => {
  console.log('wrote', out);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
