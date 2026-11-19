const PptxGenJS = require('pptxgenjs');
const path = require('path');

const A = path.join(__dirname, 'assets');
const img = (n) => path.join(A, n);

const pres = new PptxGenJS();
pres.layout = 'LAYOUT_WIDE';
pres.author = 'UXProof';
pres.title = 'UXProof';
pres.subject = 'Хакатон, 19 ноября 2026';

const INK = '1A242C';
const MUTED = '5A6874';
const GREEN = '213E33';
const PALE = 'D7EDE0';
const PAPER = 'F4F6F8';
const WHITE = 'FFFFFF';
const FAIL = 'A33A2C';
const OK = '2C6B4F';

function bg(s, color) {
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 13.33, h: 7.5, fill: { color } });
}

function title(s, text, y = 0.32) {
  s.addText(text, {
    x: 0.5, y, w: 12.3, h: 0.85,
    fontFace: 'Calibri', fontSize: 32, bold: true, color: INK, margin: 0,
  });
}

{
  const s = pres.addSlide();
  bg(s, GREEN);
  s.addText('UXProof', {
    x: 0.55, y: 1.7, w: 6.4, h: 0.45,
    fontFace: 'Calibri', fontSize: 18, color: PALE, margin: 0,
  });
  s.addText('Проверяет реальные действия пользователя и показывает, где интерфейс ломается', {
    x: 0.55, y: 2.2, w: 6.5, h: 2.4,
    fontFace: 'Calibri', fontSize: 32, bold: true, color: WHITE, margin: 0,
  });
  s.addImage({
    path: img('crop-editor.png'),
    x: 7.15, y: 0.55, w: 5.7, h: 6.4,
  });
  s.addNotes('Открываем окном продукта. Одна фраза: UXProof гоняет заданные шаги в настоящем Chromium и показывает, какой шаг не прошёл. Не перечисляем стек.');
}

{
  const s = pres.addSlide();
  bg(s, PAPER);
  title(s, 'На узком экране пропадает «На главную»');
  s.addImage({ path: img('crop-settings-desktop.png'), x: 0.4, y: 1.25, w: 7.55, h: 5.15 });
  s.addImage({ path: img('crop-settings-mobile.png'), x: 8.2, y: 1.25, w: 4.7, h: 5.15 });
  s.addText('Широкий экран: кнопка есть', {
    x: 0.4, y: 6.5, w: 7.55, h: 0.4, fontFace: 'Calibri', fontSize: 16, color: OK, margin: 0,
  });
  s.addText('390 px: кнопки нет, шаг падает за 5,5 с', {
    x: 8.2, y: 6.5, w: 4.7, h: 0.4, fontFace: 'Calibri', fontSize: 16, color: FAIL, margin: 0,
  });
  s.addNotes('Показываем два кадра Relay. Справа «На главную» исчезла. Это причина, по которой сценарий «вернуться» на мобильном не заканчивается.');
}

{
  const s = pres.addSlide();
  bg(s, PAPER);
  title(s, 'Сайт, сценарий, отчёт. Без написания теста');
  s.addImage({ path: img('crop-editor.png'), x: 0.4, y: 1.25, w: 6.4, h: 5.7 });
  s.addText('1. Адрес', {
    x: 7.05, y: 1.4, w: 5.7, h: 0.4, fontFace: 'Calibri', fontSize: 20, bold: true, color: GREEN, margin: 0,
  });
  s.addText('http://127.0.0.1:4180', {
    x: 7.05, y: 1.8, w: 5.7, h: 0.4, fontFace: 'Calibri', fontSize: 18, color: INK, margin: 0,
  });
  s.addText('2. Сценарии в редакторе', {
    x: 7.05, y: 2.5, w: 5.7, h: 0.4, fontFace: 'Calibri', fontSize: 20, bold: true, color: GREEN, margin: 0,
  });
  s.addText('Выбор сервера, сохранение, возврат. Шаги выбираются из списка.', {
    x: 7.05, y: 2.95, w: 5.7, h: 0.85, fontFace: 'Calibri', fontSize: 18, color: INK, margin: 0,
  });
  s.addText('3. Результат в том же окне', {
    x: 7.05, y: 4.0, w: 5.7, h: 0.4, fontFace: 'Calibri', fontSize: 20, bold: true, color: GREEN, margin: 0,
  });
  s.addText('Какой шаг сорвался, на каком экране, PNG доказательства.', {
    x: 7.05, y: 4.45, w: 5.7, h: 0.85, fontFace: 'Calibri', fontSize: 18, color: INK, margin: 0,
  });
  s.addNotes('Слева живой редактор. Подчёркиваем: сценарий собирается в UI, Playwright пишет разработчик продукта, не жюри.');
}

{
  const s = pres.addSlide();
  bg(s, PAPER);
  title(s, 'Один сценарий сохранения. Три ширины. Три отказа');
  const shots = [
    [img('live-settings-desktop.png'), 'Desktop 1440', 'Нет status после «Сохранить»'],
    [img('live-settings-tablet.png'), 'Tablet 768', 'Тот же шаг, тот же таймаут'],
    [img('live-settings-mobile.png'), 'Mobile 390', 'Плюс скрытая «На главную»'],
  ];
  shots.forEach((row, i) => {
    const x = 0.4 + i * 4.3;
    s.addImage({
      path: row[0], x, y: 1.25, w: 4.05, h: 4.35,
      sizing: { type: 'contain', w: 4.05, h: 4.35 },
    });
    s.addText(row[1], {
      x, y: 5.7, w: 4.05, h: 0.32, fontFace: 'Calibri', fontSize: 16, bold: true, color: INK, margin: 0,
    });
    s.addText(row[2], {
      x, y: 6.05, w: 4.05, h: 0.7, fontFace: 'Calibri', fontSize: 16, color: FAIL, margin: 0,
    });
  });
  s.addNotes('Это PNG, которые UXProof сохранил во время аудита, не макеты. Сценарий «Сохранение настроек» падает на всех трёх ширинах: нет role=status. На 390 px отдельно падает возврат.');
}

{
  const s = pres.addSlide();
  bg(s, PAPER);
  title(s, 'После правок Relay: 5/9 → 9/9 комбинаций');
  s.addText('5/9', {
    x: 0.5, y: 1.2, w: 5.8, h: 1.15, fontFace: 'Calibri', fontSize: 80, bold: true, color: FAIL, margin: 0,
  });
  s.addText('9/9', {
    x: 7.0, y: 1.2, w: 5.8, h: 1.15, fontFace: 'Calibri', fontSize: 80, bold: true, color: OK, margin: 0,
  });
  s.addText('сценарий × экран, исходный Relay', {
    x: 0.5, y: 2.35, w: 5.8, h: 0.35, fontFace: 'Calibri', fontSize: 16, color: MUTED, margin: 0,
  });
  s.addText('сценарий × экран, вариант /fixed', {
    x: 7.0, y: 2.35, w: 5.8, h: 0.35, fontFace: 'Calibri', fontSize: 16, color: MUTED, margin: 0,
  });
  s.addImage({ path: img('crop-settings-mobile.png'), x: 0.85, y: 2.75, w: 5.1, h: 4.4 });
  s.addImage({ path: img('crop-fixed-mobile.png'), x: 7.35, y: 2.75, w: 5.1, h: 4.4 });
  s.addNotes('Числа: smoke 5/9 и test:fix 9/9. Это не точность ИИ и не «все UX-ошибки исчезли». На /fixed в одном IPC-прогоне оставались confirmed находки copy/tap-target при 9/9 шагах.');
}

{
  const s = pres.addSlide();
  bg(s, PAPER);
  title(s, 'Шаг 4: нет подтверждения сохранения');
  s.addImage({ path: img('crop-modal.png'), x: 1.35, y: 1.15, w: 10.6, h: 5.7 });
  s.addText('confirmed · Сохранение настроек · компьютер · 5,5 с без role=status', {
    x: 0.5, y: 6.95, w: 12.3, h: 0.32, fontFace: 'Calibri', fontSize: 16, color: MUTED, margin: 0,
  });
  s.addNotes('Живая карточка из окна UXProof. PNG: страница после «Сохранить», status не появился.');
}

{
  const s = pres.addSlide();
  bg(s, PAPER);
  title(s, 'Измерение отдельно, гипотеза модели отдельно');
  s.addImage({ path: img('crop-results.png'), x: 0.35, y: 1.2, w: 6.3, h: 5.4 });
  s.addImage({ path: img('crop-recommendations.png'), x: 6.75, y: 1.2, w: 6.2, h: 5.4 });
  s.addText('22 confirmed, 4 axe', {
    x: 0.35, y: 6.7, w: 6.3, h: 0.35, fontFace: 'Calibri', fontSize: 16, color: FAIL, margin: 0,
  });
  s.addText('Рекомендации ИИ: 0. Переключатель был выключен', {
    x: 6.75, y: 6.7, w: 6.2, h: 0.35, fontFace: 'Calibri', fontSize: 16, color: MUTED, margin: 0,
  });
  s.addNotes('Слева список confirmed. Справа вкладка «Рекомендации» того же прогона: пусто, счётчик 0. Ollama проверяли qa:ollama отдельно, в этот отчёт не писали. Модель сайт не чинит.');
}

{
  const s = pres.addSlide();
  bg(s, GREEN);
  s.addText('Проверено 19 ноября 2026', {
    x: 0.55, y: 0.35, w: 12.2, h: 0.5, fontFace: 'Calibri', fontSize: 18, color: PALE, margin: 0,
  });
  const stats = [
    ['127', 'runner-тестов прошли', 'ещё 1 skip без Python cryptography'],
    ['19/19', 'тестов Rust', 'включая снятие sidecar с окном'],
    ['9/9', 'сценариев в release-окне', 'qa:ipc, WebView2 CDP'],
    ['MSI', 'свой Node и Chromium', 'установка на Windows 10, WebView2 уже был'],
  ];
  stats.forEach((row, i) => {
    const col = i % 2;
    const rowi = Math.floor(i / 2);
    const x = 0.55 + col * 6.4;
    const y = 1.15 + rowi * 2.55;
    s.addText(row[0], {
      x, y, w: 6.0, h: 1.15, fontFace: 'Calibri', fontSize: 52, bold: true, color: WHITE, margin: 0,
    });
    s.addText(row[1], {
      x, y: y + 1.15, w: 6.0, h: 0.45, fontFace: 'Calibri', fontSize: 20, color: WHITE, margin: 0,
    });
    s.addText(row[2], {
      x, y: y + 1.6, w: 6.0, h: 0.55, fontFace: 'Calibri', fontSize: 16, color: PALE, margin: 0,
    });
  });
  s.addText('Платный OpenAI не вызывали. Образ без WebView2 не ставили.', {
    x: 0.55, y: 6.5, w: 12.2, h: 0.45, fontFace: 'Calibri', fontSize: 16, color: PALE, margin: 0,
  });
  s.addNotes('Читаем панель, не список. 127 pass + 1 skip, не «128 зелёных». MSI: mono, не чистая VM.');
}

{
  const s = pres.addSlide();
  bg(s, PAPER);
  title(s, 'Сценарий в окне, прогон в браузере, два класса находок');
  const rows = [
    ['Playwright / Cypress', 'Пишете тест кодом. Отчёт для разработчика.'],
    ['Lighthouse / axe', 'Страница и WCAG-теги. Сценарий «сохранить → status» сами не проходят.'],
    ['Percy / Applitools', 'Картинка изменилась. Клик мог и не дойти.'],
    ['UXProof', 'Сценарий в UI → Chromium → PNG шага. confirmed отдельно от recommendation.'],
  ];
  rows.forEach((row, i) => {
    const y = 1.3 + i * 1.4;
    const dark = i === 3;
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.5, y, w: 12.3, h: 1.25, fill: { color: dark ? GREEN : WHITE },
    });
    s.addText(row[0], {
      x: 0.75, y: y + 0.18, w: 3.6, h: 0.9,
      fontFace: 'Calibri', fontSize: 18, bold: true, color: dark ? WHITE : GREEN, margin: 0, valign: 'middle',
    });
    s.addText(row[1], {
      x: 4.5, y: y + 0.18, w: 8.0, h: 0.9,
      fontFace: 'Calibri', fontSize: 18, color: dark ? PALE : INK, margin: 0, valign: 'middle',
    });
  });
  s.addNotes('Не говорим, что конкуренты «не умеют». Умеют через код и интеграции. UXProof собирает этот контур в окне для человека, который тест писать не хочет.');
}

{
  const s = pres.addSlide();
  bg(s, GREEN);
  s.addText('UXProof', {
    x: 0.55, y: 1.5, w: 8.5, h: 0.5, fontFace: 'Calibri', fontSize: 18, color: PALE, margin: 0,
  });
  s.addText('Девять комбинаций. Пять падают. После правки проходят все девять.', {
    x: 0.55, y: 2.15, w: 8.6, h: 1.8, fontFace: 'Calibri', fontSize: 32, bold: true, color: WHITE, margin: 0,
  });
  s.addText('Исходники: github.com/Narut0-1488/UXProof\nЖивое окно только на Windows, не веб-сервис.', {
    x: 0.55, y: 4.3, w: 8.6, h: 1.2, fontFace: 'Calibri', fontSize: 18, color: PALE, margin: 0,
  });
  s.addShape(pres.shapes.RECTANGLE, { x: 9.7, y: 1.7, w: 2.9, h: 2.9, fill: { color: WHITE } });
  s.addImage({ path: img('qr-github.png'), x: 9.85, y: 1.85, w: 2.6, h: 2.6 });
  s.addText('Репозиторий, не онлайн-демо', {
    x: 9.5, y: 4.75, w: 3.3, h: 0.7, fontFace: 'Calibri', fontSize: 14, color: PALE, margin: 0, align: 'center',
  });
  s.addNotes('Финал на числе 5/9 → 9/9. QR ведёт на GitHub. Сказать вслух: SaaS нет, запуск локальный, инструкция в docs/submission/03-demo.md.');
}

pres.writeFile({ fileName: path.join(__dirname, '02-prezentatsiya.pptx') }).then(() => {
  console.log('wrote pptx');
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
