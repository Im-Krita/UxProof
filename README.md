# UXProof — evidence-first UX audit (MVP v0.1.0)

Windows-first приложение для проверки **реальных пользовательских действий** в веб-интерфейсе. Tauri 2 + Rust orchestrator, React/TypeScript UI, Playwright browser runner, axe-core accessibility, опциональный ИИ (OpenAI Responses API или локальный Ollama).

**Статус:** разработка продолжается. Сборки MSI и NSIS содержат Node.js и Chromium; запуск извлечённых файлов проверен в изолированном окружении. Установка на чистую Windows VM и полный сценарий Tauri IPC ещё не проверены. Актуальные ограничения: `docs/CORE-IMPLEMENTATION-STATUS.md`.

## Быстрый старт — режим разработки (Windows)

Требования: Node.js 22+, npm, подключение к сети для первоначальной установки зависимостей и браузера.

```powershell
# Корневая папка архива
npm install
cd runner
npm install
npx playwright install chromium
cd ..
```

Запустите **в двух отдельных терминалах**:

```powershell
npm run demo
```

```powershell
npm run dev
```

Откройте `http://127.0.0.1:1420`. Адрес тестового Relay уже введён (`http://127.0.0.1:4180`). Нажмите **«Запустить аудит»**. Это реальный запрос к локальному runner по `/api` (не имитация).

Если порт 1420 / 4179 / 4180 занят, освободите его или измените все соответствующие адреса в `vite.config.ts`, `runner/dev-server.mjs`, `demo/server.mjs`, `src/lib/presets.ts`.

## Десктоп Tauri 2

Помимо Node.js нужны: Rust toolchain (rustup), Microsoft C++ Build Tools / MSVC и WebView2, см. [официальные prerequisites](https://v2.tauri.app/start/prerequisites/).

```powershell
npm run demo            # отдельный терминал
npm run tauri dev       # запускает Vite + окно Tauri 2
```

В режиме Tauri интерфейс вызывает команды Rust через IPC, Rust проверяет входные данные, запускает Node runner и сохраняет отчёт в каталоге данных приложения Windows. Отдельный `dev:api` **для Tauri не нужен**.

Для Windows x64 `npm run tauri build` подготавливает встроенные Node.js и Chromium и создаёт MSI/NSIS. На машине сборки нужен точный официальный `node.exe` версии 24.14.1: сборщик проверяет SHA-256 и по умолчанию использует текущий Node; другой путь можно указать через `UXPROOF_NODE_BINARY`. Предварительно установите зависимости runner и Chromium Headless Shell соответствующей версии Playwright (`cd runner; npx playwright install --only-shell chromium; cd ..`). При нестандартном кэше задайте `PLAYWRIGHT_BROWSERS_PATH`. Каждый включаемый файл Chromium сверяется с манифестом SHA-256, сформированным из архива Chrome for Testing, полученного по HTTPS с официального хранилища Google; обновление ревизии требует обновить манифест. Отдельная криптографическая подпись архива не проверялась. `npm run test:portable` проверяет запуск упакованных ресурсов вне checkout с изолированными PATH и браузерным кэшем.

MSI был распакован и его runner с встроенными Node и Chromium выполнил аудит в изолированном окружении. Полная установка и Tauri IPC на чистой Windows VM ещё не подтверждены; WebView2 и требования Windows также нужно проверить на целевой системе.

## Что делает v0.1

- 3 редактируемых сценария с проверкой результата каждого шага;
- 3 разрешения: 1440×900, 768×1024, 390×844; можно отключать размеры;
- реальные `click`, `fill`, `select`, `check`, `navigate`, `expectVisible`, `expectHidden`, `expectText`, `expectValue`, `wait` в Chromium;
- изолированный browser context для каждой пары сценарий×экран;
- снимок экрана по завершении проверки, информация об ошибочном шаге и путь воспроизведения;
- автоматизированная accessibility-проверка с axe-core, JavaScript exceptions, проверка горизонтального overflow;
- раздельные **подтверждённые дефекты** и **рекомендации ИИ**;
- сохранение запусков на диск, локальная история, сравнение количества успешных запусков и дефектов «до/после», JSON, HTML и Excel-отчёт (рядом со скриншотами);
- правила реестра: `layout:viewport-overflow`, `layout:min-tap-target`, `layout:text-overflow`, `copy:duplicate-heading`, `copy:repeated-button-name`;
- генерация шагов по тексту цели (`/api/plan`, `plan_steps`) с ручным подтверждением в UI;
- импорт/экспорт конфигурации проекта JSON (импорт проходит тот же валидатор, что и запуск);
- тестовое Relay-приложение с намеренно нарушенными UX-сценариями;
- облачный OpenAI или локальный Ollama для доп. обзора скриншотов, переключение в UI.

## ИИ-анализ (необязателен)

По умолчанию выключен. При активации максимум 3 скриншота за запуск направляются выбранной мультимодальной модели. Проверки работают **без ИИ**.

**OpenAI:** перед запуском задайте `OPENAI_API_KEY` в переменных окружения процесса (PowerShell: `$env:OPENAI_API_KEY="..."`). Модель через `UXPROOF_AI_MODEL` (по умолчанию `gpt-4.1-mini`). Используется Responses API с `store: false`. Не размещайте ключ в файлах фронтенда или в `VITE_*`.

**Ollama:** заранее установите Ollama и запустите сервис. Проверено вживую: для обзора скриншотов `ollama pull qwen2.5vl:3b` (`UXPROOF_OLLAMA_MODEL=qwen2.5vl:3b`), для планировщика шагов `ollama pull qwen2.5:3b` (`UXPROOF_PLANNER_MODEL=qwen2.5:3b`). `moondream` и `llama3.2:1b` на реальных экранах вырождаются в повтор токенов и отвечают HTTP 500, поэтому в примерах их нет. Обмен через локальный `http://127.0.0.1:11434/api/chat`. Можно указать свой порт через `UXPROOF_OLLAMA_URL`; удалённые хосты в MVP не разрешены.

Сквозная проверка локальной модели: `npm run qa:ollama` (нужны запущенные Ollama и `npm run demo`). Скрипт вызывает живой планировщик, прогоняет аудит с включённым ИИ и проверяет, что рекомендации остаются `recommendation`.

Рекомендации помечаются как рекомендации. Модель **не исполняет** действий по снимкам экрана, а только классифицирует видимые проблемы. Результаты ИИ не являются фактом без независимой проверки.

## Синтаксис селекторов

| Пример | Как выбирается элемент |
|---|---|
| `role:button\|Подключиться` | Доступная кнопка с точным именем |
| `label:Email` | Поле по метке |
| `placeholder:Поиск` | Поле по плейсхолдеру |
| `testid:save-button` | Элемент по `data-testid` |
| `text:Добро пожаловать` | Текст (точное совпадение) |
| `css:#submit` | CSS selector |

`navigate` принимает относительный путь в поле «Значение», `select` — `value` нужной опции, `expectText` — ожидаемую подстроку, `expectValue` — точное значение поля.

**Важное:** если элемент не найден за 5,5 секунд, шаг считается упавшим. Последующие шаги сценария не запускаются; отдельно выполняются axe и создание скриншота. Демо не выполняет действия на реальных VPN-серверах.

## Примеры конфигураций

- `samples/demo.audit.json` — 3 сценария × 3 экрана, повторяет дефекты Relay и используется `smoke`/`test:fix`.
- `scripts/qa-ollama.mjs` — живой планировщик и vision-review на локальном Ollama.
- `scripts/qa-ipc.mjs` — прогон аудита кнопкой в собранном окне Tauri (WebView2 CDP).
- `samples/demo.extended.audit.json` — расширенный набор: профили, вход по текстовым селекторам, `fill`, `expectValue`, `wait` и намеренно неоднозначный селектор. Полезен, чтобы увидеть падение шага со strict-mode ошибкой и `copy:repeated-button-name` в отчёте.

## Структура

```text
UXProof-MVP-v0.1/
├── TZ.md                  подробное техническое задание
├── README.md
├── docs/                 архитектура, тесты, ограничения, demo
├── demo/                 локальное веб-приложение с ошибками
├── runner/               Playwright, axe-core, OpenAI/Ollama, отчеты
├── scripts/dev.mjs       dev API + Vite одновременно
├── src/                  React TypeScript UI
└── src-tauri/            Tauri 2, Rust IPC, файлы и запуск Node
```

## Проверки

```powershell
npm run test:runner           # Node unit/integration tests, требует runner/npm install и Chromium
npm run build                 # проверка TS + Vite
npm run smoke                 # реальный прогон 9 комбинаций, требует demo + dependencies
npm run test:edge             # границы безопасности и ошибки, требует runner и Chromium
npm run test:fix              # прогон исправленного Relay (/fixed)
npm run test:portable         # release-ресурсы вне checkout (нужен подготовленный runtime)
npm run qa:ollama             # живая локальная модель: planning + vision (нужны Ollama и demo)
npm run qa:ipc                # прогон аудита в собранном окне Tauri через WebView2 CDP
```

CI — `.github/workflows/ci.yml`: обязательная job (runner-тесты, сборка UI, `cargo test`), отдельная job с Relay для `test:edge`/`test:fix`/`smoke` и ночной `test:portable`.

Дополнительные критерии приёмки — `docs/TEST_PLAN.md` и `docs/VALIDATION.md`.

## MCP и локальный API

Dev API (`npm run dev:api`) слушает только `127.0.0.1`. При заданном `UXPROOF_DEV_TOKEN` запросы к `run`, `cancel`, `history`, `plan` требуют этого токена в заголовке `X-UXProof-Token` (или `Authorization: Bearer`); заголовок `X-UXProof-Client` остаётся дополнительной проверкой, но не заменяет токен.

```powershell
$env:UXPROOF_DEV_TOKEN="локальный-секрет"
npm run dev:api
node runner/mcp-server.mjs     # stdio MCP: run_audit, cancel, list_reports, get_report
```

MCP-инструменты возвращают `runId`, сводку и счётчики без изображений и работают только пока запущен dev API. Токен не коммитится и не попадает в отчёты.

## Конфиденциальность и ограничения

- Тестируйте только собственные сайты, локальные приложения или ресурсы с разрешением.
- При выборе OpenAI изображения передаются внешнему API. Секреты, переписку и персональные данные не загружайте без согласия.
- Runner не ограничен «безопасными» кликами: сценарий может выполнить кнопку удаления или покупки. В v0.1 нет sandbox-аккаунтов, ручной защиты destructive actions, рекордера или балансировки очереди.
- JSON/HTML/PNG содержат проверяемую информацию, хранятся без шифрования. Не используйте реальные пароли в тестовом сценарии.
- 0 предупреждений axe-core **не доказывает** полное соответствие WCAG. Рекомендации ИИ субъективны. Отсутствие упавших шагов не гарантирует отсутствие UX-проблем.

## Первоначальные библиотеки / документация

Использованы готовые инструменты, а не собственная реализация браузера или WCAG-движка: [Playwright](https://playwright.dev/docs/intro), [@axe-core/playwright](https://www.npmjs.com/package/@axe-core/playwright), [Tauri 2](https://v2.tauri.app/), [OpenAI vision](https://developers.openai.com/api/docs/guides/images-vision). См. `docs/DEPENDENCIES.md`.
