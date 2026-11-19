# Матрица функциональности UXProof

Статусы обновлены 19 ноября 2026 после прогонов на Windows: `test:runner` 128 тестов (127 pass, 1 skip по Python HTTPS), `cargo test --locked` 18/18, `npm run build`, smoke 5/9, `/fixed` 9/9, живой прогон Ollama (`scripts/qa-ollama.mjs`) и IPC-прогон в собранном окне (`scripts/qa-ipc.mjs`). «Implemented & Tested» означает, что поведение наблюдалось командой или в браузере, а не только по наличию кода. Строки без такого наблюдения помечены Partially Implemented, даже если код готов.

| ID | Название | Описание | UI | Backend | Реализация | Статус | Автотест | Ручная проверка | Баги | Ограничения | Дальше |
|---|---|---|---|---|---|---|---|---|---|---|---|
| FR-001 | Проект | Имя и URL | Да | Да | Поля в редакторе, контракт `AuditConfig` | Implemented & Tested | Косвенно через smoke | Браузер: имя и `http://127.0.0.1:4180` отображаются | — | — | — |
| FR-002 | Валидация URL | Только `http(s)`, без логина, без `file:` и `javascript:` | Да | Да | UI, Node, Rust | Implemented & Tested | validators, policy, `cargo test`, `test:edge` | `file:///C:/Windows/win.ini` остановлен в UI | BUG-001, BUG-011 | Явный локальный адрес проекта разрешён | Сетевой allowlist доменов |
| FR-003 | Сценарии | До 10, создание и удаление | Да | Да | Список и редактор | Implemented & Tested | Валидатор границ | В UI видны 3 сценария и кнопка добавления | — | Удаление последнего запрещено | — |
| FR-004 | Шаги | До 30, типы действий, порядок | Да | Да | Редактор, вверх/вниз | Implemented & Tested | Юнит-тесты типов | В браузере шаг 2 поднят и возвращён | BUG-008 | Нет drag-and-drop | Запись кликов, P1 |
| FR-005 | Селекторы | role, label, text, css, testid, placeholder | Да | Да | `locatorFor` | Implemented & Tested | smoke использует role и css | Те же сценарии прошли в UI | — | Не покрыт отдельным тестом каждый префикс | — |
| FR-006 | Экраны | Desktop, tablet, mobile, минимум один | Да | Да | Три пресета, `aria-pressed` | Implemented & Tested | smoke 3×3 | Плитки в UI нажаты | — | Свой размер только через JSON | — |
| FR-007 | Playwright | Реальный Chromium | Нет отдельной кнопки | Да | `runner/audit.mjs` | Implemented & Tested | smoke, fix, edge, UI-прогон | 9 комбинаций, скриншоты PNG | — | Нужен установленный Chromium | — |
| FR-008 | Изоляция | Новый context на пару сценарий×экран | Нет | Да | `browser.newContext` | Implemented & Tested | Код пути покрыт успешным прогоном | Состояние подключения не переносится: каждый экран начинает с главной | — | Серверное состояние сайта не сбрасывается | Фикстуры, P1 |
| FR-009 | Дефект шага | Причина, номер, сценарий, воспроизведение | Да | Да | `issues[]` и диалог | Implemented & Tested | smoke проверяет упавшие шаги | Диалог показал путь «Открыть настройки → … → Увидеть подтверждение» и PNG 1440px | BUG-003 | Снимок делается в конце комбинации, не на каждом шаге | Снимки шагов, P1 |
| FR-010 | axe-core | WCAG-теги, rule id, узлы | Да | Да | `@axe-core/playwright` | Implemented & Tested | smoke ждёт `color-contrast` | В UI виден `.bad-contrast` | — | axe не доказывает полное WCAG | — |
| FR-011 | JS-ошибки | `pageerror` | Да | Да | Слушатель страницы | Implemented & Tested | smoke и fix | Текст «необработанное исключение при открытии настроек» | — | Ловит необработанные исключения, не `console.error` | — |
| FR-012 | Горизонтальный вылет | `scrollWidth` против окна | Да | Да | `page.evaluate` | Implemented & Tested | smoke и fix | «Контент 2101px шире окна 1440px» | — | Порог +3px | — |
| FR-013 | Скриншоты | PNG и просмотр | Да | Да | Файл и `/api/image` или data URL | Implemented & Tested | smoke проверяет размер файлов | В диалоге `naturalWidth=1440` | BUG-003, BUG-004 | — | — |
| FR-014 | ИИ | [OI] или Ollama, необязательно | Да | Да | `runner/ai.mjs`, выключатель ИИ | Implemented & Tested | Юнит-тесты: нет ключа, HTTP 401 без утечки ключа, чужой Ollama, битый JSON; `scripts/qa-ollama.mjs` | Живой прогон Ollama: `qwen2.5vl:3b` дала 3 рекомендации по реальному скриншоту, предупреждений нет, `aiSuggestions` совпал. `moondream` на этом экране вырождается в повтор токенов (HTTP 500), поэтому для QA берётся `qwen2.5vl:3b` | BUG-013 | Не больше 3 вызовов модели за прогон; `moondream` годится не для всех экранов | Платный API не вызывался |
| FR-015 | Доверие | `confirmed` отдельно от `recommendation` | Да | Да | `evidenceType`, фильтры | Implemented & Tested | Юнит-тест и smoke: рекомендаций 0 | Фильтры «Дефекты» и «ИИ» есть в результатах | — | — | — |
| FR-016 | История | Последние 30 JSON | Да | Да | Диск `.uxproof-data/runs` и команда Rust | Implemented & Tested | `history.test.mjs`, миграция схемы, `skipped` в ответе обоих backend | UI показывает число пропущенных записей | — | В режиме Tauri каталог другой; открытие истории в окне не нажималось | — |
| FR-017 | HTML | Экранирование и ссылки на PNG | Да | Да | `renderHtml` | Implemented & Tested | Юнит-тест XSS и `../` | UI: «HTML-отчёт скачивается браузером». Файл 9595 байт, 9 PNG, тега `script` нет | BUG-004 | — | — |
| FR-018 | JSON | Проект и отчёт | Да | Да | Скачивание и `report.json`; импорт проходит общий `projectConfigError` | Implemented & Tested | `validators`/`report-schema` и UI-проверка конфигурации | Кнопка JSON есть; импорт валидируется до запуска | BUG-011 | — | — |
| FR-019 | Tauri IPC | Rust проверяет ввод и запускает Node | Да | Да | `commands.rs`: `run_audit`, `cancel_audit`, `export_*`, `plan_steps` | Implemented & Tested | `cargo test --locked` 18/18: блокировки, URL, spawn, verbatim-пути, отмена; `scripts/qa-ipc.mjs` | Прогон в собранном окне через WebView2 CDP: 9/9 сценариев, 3 подтверждённых дефекта, JSON/Excel/HTML на месте | BUG-025, BUG-026 | В бандле на Windows Tauri отдаёт `\\?\`-путь: Node его не принимает, а CLI повторно брал уже занятый app-лок. Исправлено (`plain_path`, `UXPROOF_LOCK_HELD`) | Установка MSI на чистую VM |
| FR-020 | Автономный установщик | Свой Node и Chromium | Нет | Да | Встроенные Node 24 и Chromium Headless Shell в `resources/runtime`, SHA-256 манифест | Implemented & Tested | `test:portable`, сверка 288 файлов Chromium, MSI/NSIS собраны | MSI распакован без установки: аудит выполнен встроенными Node и Chromium; release-окно после правки путей запускает тот же встроенный Node и завершает прогон | BUG-012, BUG-025 | Установка MSI на чистую Windows VM и WebView2-прогон там не выполнялись | Пройти `docs/VM-ACCEPTANCE.md` |
| FR-021 | ИИ-агент навигации | План по тексту | Да | Да | `runner/planner.mjs` + `plan_steps` IPC и `/api/plan` | Implemented & Tested | `planner.test.mjs`: типы, префиксы, off-origin `navigate`, общий `validateConfig`; `scripts/qa-ollama.mjs` | Живой вызов `qwen2.5:3b`: 2 шага (`navigate`, `expectVisible`) прошли тот же валидатор; `llama3.2:1b` вырождается в повтор токенов, для планировщика не годится | — | План остаётся предложением, не находкой; 9b (модель кликает сама) отсутствует | UI: превью и «Применить план» |
| FR-022 | Excel | XLSX | Да | Да | `runner/xlsx.mjs` и `export-xlsx.mjs`, `report.xlsx`, `export_xlsx` IPC и `/api/xlsx` | Implemented & Tested | `xlsx.test.mjs`: части архива, контрольные суммы, экранирование, имена листов | Кнопка «Excel» в отчёте вызывает экспорт | — | PNG не встраиваются; живого экспорта из окна Tauri не было | — |
| FR-023 | CI | GitHub Actions | Нет | Да | `.github/workflows/ci.yml`: required, integration, nightly portable | Implemented | Локально те же команды зелёные | Прогон в GitHub не наблюдался | — | Integration job требует Relay; portable — nightly | Первый прогон workflow |
| FR-024 | MCP | Внешние инструменты | Нет | Да | `runner/mcp-server.mjs` (stdio) поверх dev API | Implemented & Tested | `dev-token.test.mjs`; `mcp-client.integration.test.mjs` — официальный `@modelcontextprotocol/sdk`: `initialize`, `tools/list`, `run_audit`, `list_reports`, `get_report`, `cancel` | Реальный MCP-клиент подключился по stdio и прогнал все инструменты | BUG-027 | Только dev API; в упакованном MSI без API MCP не работает | — |
| DEMO-A | Нет подтверждения сохранения | `role=status` отсутствует | Демо | Демо | `demo/index.html` | Implemented & Tested | smoke: падение на всех 3 экранах; `/fixed`: 4/4 | UI показал тот же шаг | — | — | — |
| DEMO-B | Скрытая «На главную» | На ширине до 520px | Демо | Демо | CSS `.back` | Implemented & Tested | smoke: Mobile 1/3, Desktop и Tablet проходят; `/fixed`: Mobile 3/3 | UI: «Вернуться на главную» только на Mobile | — | — | — |
| DEMO-C | Исключение и вылет | Настройки бросают ошибку и рисуют блок 1800px | Демо | Демо | Вариант `/` и `/fixed` | Implemented & Tested | smoke: javascript + overflow; `/fixed`: оба исчезли | Текст исключения виден в UI | — | На Desktop/Tablet после успешного возврата вылет уже не измеряется: страница сменилась | — |

## Правила реестра v0.1

`options.disabledRules` отключает любое из правил в проектном JSON; неизвестный ID отклоняется валидатором.

| Правило | Категория | Что измеряется | Статус | Автотест | Ограничение |
|---|---|---|---|---|---|
| `layout:viewport-overflow` | layout | `scrollWidth` документа против ширины viewport, допуск 3 CSS px | Implemented & Tested | `rules.integration.test.mjs` (Chromium) | Первый hop HTTP-redirect не измеряется после смены origin |
| `layout:min-tap-target` | layout | видимые интерактивные элементы меньше 24×24 CSS px | Implemented & Tested | `detectors.integration.test.mjs` | Порог фиксирован; touch-эвристики не различаются |
| `layout:text-overflow` | layout | элементы с `text-overflow: ellipsis` и `scrollWidth > clientWidth` | Implemented & Tested | `detectors.integration.test.mjs` | Не доказывает потерю смысла; только факт обрезки |
| `copy:duplicate-heading` | copy | точные повторы видимых заголовков после нормализации | Implemented & Tested | `copy-headings.integration.test.mjs` | Гипотеза; текст в JSON/HTML не пишется |
| `copy:repeated-button-name` | copy | повторы видимых названий кнопок в viewport | Implemented & Tested | `detectors.integration.test.mjs` | Гипотеза; одинаковые подписи могут быть оправданы |
# Дополнение: ядро v0.3

Нормализованные наблюдения axe и упавших шагов Playwright и версионированная схема расширения покрывают javascript, overflow, гипотезы правил и рекомендации ИИ. Актуальный статус и ограничения: `CORE-IMPLEMENTATION-STATUS.md`.

Блокировка Tauri IPC дополнена файловой блокировкой между экземплярами приложения. Проверено Rust-тестами; конкурентные вызовы из окна Tauri ещё не проверены.

Новые Tauri-запуски передают конфигурацию через stdin; поля и непрозрачные поверхности маскируются на PNG. Приватность произвольного видимого текста пока не гарантируется.

Неполные записи истории пропускаются при отображении без удаления файлов. Проверены старые отчёты и локальный API с повреждёнными файлами.

Ресурсы release перечислены явно; проверены изолированный запуск runner и исключение фиктивных файлов из манифестов MSI/NSIS. Release-сборка включает Node 24 и Chromium Headless Shell; debug-сборка по-прежнему берёт системный Node.

Сетевая проверка использует аутентифицированный локальный прокси и закрепляет разрешённые DNS-адреса соединения; тестированы redirect, DNS, HTTP/HTTPS и WebSocket. Переход другого origin обнаруживается после первой загрузки; полная изоляция ОС и popup ещё не подтверждены.

Ошибочный шаг получает отдельный PNG до последующих проверок; отсутствие PNG ошибки не подменяется конечным снимком. Manifest проверен после копирования отчёта; события шагов и частичная структурная сводка DOM сохраняются. Для ошибки шага частично сохраняется геометрия элемента и отображается рамка на связанном PNG; атомарное совпадение с PNG не гарантируется. Опциональный trace создаётся только при ошибке и содержит предупреждение о возможных чувствительных данных.

Интерфейс показывает сгруппированные наблюдения и осторожное сопоставление одинаковых ID. Для ошибок шагов показывается число повторно пройденных комбинаций; при проверенном совпадении страницы фиксируется прекращение ошибки выполнения шага, а не общее исправление UX. Пользователь может явно сопоставить разные пути одного origin при одинаковом профиле проверки. Полное сравнение исправлений и регрессий остаётся открытым.

Правила реестра подключаются через общий исполняемый интерфейс: `layout:viewport-overflow`, `layout:min-tap-target`, `layout:text-overflow`, `copy:duplicate-heading`, `copy:repeated-button-name`. Каждое правило отключается через `options.disabledRules`; исполняемый интерфейс вынесен в `runner/detectors.mjs` и не требует правок середины `audit.mjs`.

Детекторы реестра возвращают счётчики и пороги; текст страницы в JSON/HTML не записывается. Гипотезы правил считаются отдельно от рекомендаций ИИ.

PNG маскирует поля и буквальные совпадения значений `fill`/`expectValue` в тексте; неизвестные или преобразованные секреты могут остаться видимыми.

Добавлены Excel-экспорт (`report.xlsx`, IPC `export_xlsx`, `/api/xlsx`), планировщик шагов с ручным подтверждением (`runner/planner.mjs`, `/api/plan`, `plan_steps`) и MCP stdio-сервер (`runner/mcp-server.mjs`) поверх dev API с обязательным `UXPROOF_DEV_TOKEN`. Планировщик и MCP не управляют браузером и не обходят валидацию конфигурации.


