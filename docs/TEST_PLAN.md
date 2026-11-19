# План проверки и приёмки — UXProof v0.1

**Это список запланированных проверок, не отчёт об их прохождении.** Фактические результаты см. `VALIDATION.md` и `FINAL-AUDIT-REPORT.md`.

Статус автоматизации на 19.11.2026:

- `npm run test:runner` — 125 тестов, 124 pass, 1 skip (HTTPS-прокси без Python `cryptography`).
- `cargo test --locked` — 17/17.
- `npm run build` — успешно.

Соответствие проверок автотестам:

| QA | Доказательство |
|---|---|
| QA-01, QA-02 | `npm ci`, `npx playwright install chromium` выполнены на этой машине |
| QA-05, QA-06…QA-14 | `scripts/smoke.mjs` (Relay `/`) и `scripts/verify-fix.mjs` (`/fixed`) |
| QA-16, QA-17, QA-18 | `runner/tests/ai.test.mjs`, smoke с `enableAI: false` |
| QA-21, QA-22 | `runner/tests/report-schema.test.mjs`, `validators.test.mjs` |
| QA-23, QA-24 | `runner/tests/validators.test.mjs` — `renderHtml`: XSS в названии и отказ от `../` |
| QA-25, QA-26, QA-27 | `policy.test.mjs`, `validators.test.mjs`, `test:edge` |
| QA-28 | `comparison.integration.test.mjs`, прогоны `/` → `/fixed` |
| QA-29, QA-32 | `cancel.test.mjs`, `failure-evidence.test.mjs` |
| QA-34, QA-35, QA-39 | `detectors.integration.test.mjs`, `rules.integration.test.mjs` |
| QA-37 | `privacy.test.mjs` |
| QA-40 | `runner/tests/xlsx.test.mjs` |
| QA-41 | `runner/tests/dev-token.test.mjs` |
| QA-43, QA-44 | `runner/tests/planner.test.mjs` |
| QA-45 | `shared/config-check.mjs` и `runner/tests/validators.test.mjs` |
| QA-46 | `runner/tests/history.test.mjs` |
| QA-47 | `runner/tests/axe-guard.integration.test.mjs` |
| QA-20 (живая модель), QA-48 | `scripts/qa-ollama.mjs` (Ollama `qwen2.5vl:3b` + `qwen2.5:3b`) |
| QA-30 (окно), QA-49 | `scripts/qa-ipc.mjs` в release-окне через WebView2 CDP |
| QA-42 (MCP-клиент), QA-50 | `runner/tests/mcp-client.integration.test.mjs` |

Ручные и непроверенные пункты: QA-19, QA-31, QA-36, QA-38, а также установка MSI на чистую VM — `docs/VM-ACCEPTANCE.md`.

Легенда: **авто** — покрыто тестом, **ручной** — нужен прогон человеком, **нет** — не проверялось.

| ID | Приёмочный тест | Ожидаемый результат | Приоритет |
|---|---|---|---|
| QA-01 | `npm install` + `runner/npm install` | Зависимости установлены | P0 |
| QA-02 | `npx playwright install chromium` | Chromium доступен | P0 |
| QA-03 | `npm run demo` | Relay открывается по 127.0.0.1:4180 | P0 |
| QA-04 | `npm run dev` | UI + dev API по двум портам | P0 |
| QA-05 | Web-режим: нажать «Запустить аудит» | Реальный JSON возвращён из Playwright | P0 |
| QA-06 | Проверка «Выбор сервера» desktop | 4/4 шагов проходят | P0 |
| QA-07 | Проверка «Выбор сервера» tablet | 4/4 шагов проходят | P0 |
| QA-08 | Проверка «Выбор сервера» mobile | 4/4 шагов проходят | P0 |
| QA-09 | «Сохранение настроек» desktop | Ошибка ожидания `[role="status"]` | P0 |
| QA-10 | «Сохранение настроек» tablet | Та же ошибка | P0 |
| QA-11 | «Сохранение настроек» mobile | Та же ошибка | P0 |
| QA-12 | «Возврат на главную» desktop | 3/3 шагов проходят | P0 |
| QA-13 | «Возврат на главную» tablet | 3/3 шагов проходят | P0 |
| QA-14 | «Возврат на главную» mobile | Скрытая кнопка, шаг `click` падает | P0 |
| QA-15 | Клик по функциональному дефекту | Скриншот и инструкция воспроизведения | P0 |
| QA-16 | Проверка axe-core | Отдельные accessibility rules, без LLM | P0 |
| QA-17 | Отключить ИИ и запустить | Все проверки выполняются без API ключа | P0 |
| QA-18 | Включить ИИ без ключа OpenAI | Тест проходит, warning содержит причину | P0 |
| QA-19 | Включить OpenAI с рабочим ключом | Рекомендации с классом `recommendation`, не `confirmed` | P0 |
| QA-20 | Включить Ollama с vision-моделью | Локальный review, нет запроса к облачному API | P1 |
| QA-21 | Экспорт JSON проекта | Можно снова импортировать этот файл | P0 |
| QA-22 | Экспорт JSON отчёта | Есть runId, все результаты и проблемы | P0 |
| QA-23 | Экспорт HTML | Отчёт открывается со скриншотами из соседней папки | P0 |
| QA-24 | Проверка HTML XSS | `<script>` из названия экранируется | P0 |
| QA-25 | Отправить URL `file:///...` | Тест блокируется | P0 |
| QA-26 | Отправить шаг `eval` | Тест блокируется | P0 |
| QA-27 | Попытка path traversal в image endpoint | HTTP 400 | P0 |
| QA-28 | Повторить прогон после внесения исправления в Relay | Проблема исчезла, есть два разных отчёта | P0 |
| QA-29 | Завершение процесса Chromium по ошибке | UI показывает причину, не фиктивный успех | P0 |
| QA-30 | `npm run tauri dev` на Windows | Окно Tauri, Rust IPC и реальный runner | P0 |
| QA-31 | Открыть ранее сохранённый отчёт | Отчёт читается из app data | P0 |
| QA-32 | Сценарий с недоступным селектором | 1 ошибка, следующие шаги не выполняются | P0 |
| QA-33 | Повторный аудит с изменённым размером | Применяется новое выбранное разрешение | P1 |
| QA-34 | Сайт с JavaScript exception | `javascript` issue с сообщением ошибки | P1 |
| QA-35 | Сайт с горизонтальным overflow | `overflow` issue с числами | P1 |
| QA-36 | Страница с login-экраном | Runner не пытается обойти авторизацию; сценарий падает прозрачно | P1 |
| QA-37 | Проверка локального хранения ключа API | Нет в JSON отчёта, HTML и логах | P0 |
| QA-38 | Rust + Tauri release bundle | Проверка компиляции и зависимостей | P1 |
| QA-39 | Детекторы реестра (`layout:min-tap-target`, `layout:text-overflow`, `copy:repeated-button-name`) | Счётчики и пороги в отчёте, отключение через `disabledRules` | P1 |
| QA-40 | Экспорт Excel | `report.xlsx` открывается, листы «Сводка», «Проблемы», «Прогоны» | P1 |
| QA-41 | Запуск dev API без `UXPROOF_DEV_TOKEN` | `/api/run`, `/api/cancel`, `/api/history` отвечают 403 без токена | P0 |
| QA-42 | MCP stdio с токеном | `tools/list` возвращает `run_audit`, `cancel`, `list_reports`, `get_report` | P1 |
| QA-43 | Планировщик: «Сгенерировать шаги» | Превью шагов, «Применить план» заменяет шаги сценария; без подтверждения ничего не запускается | P1 |
| QA-44 | Планировщик с `navigate` на чужой origin | Шаг отброшен до запуска аудита | P0 |
| QA-45 | Импорт проекта с `javascript:`/`file:`/пустым `expectText` | Импорт отклонён до кнопки запуска | P0 |
| QA-46 | История с повреждённой записью | Запись пропущена, показано число `skipped`, файл не удалён | P1 |
| QA-47 | Страница с нарушением контраста при включённом стороже посторонних страниц | `color-contrast` попадает в отчёт, предупреждений `axe … Target page … has been closed` нет | P0 |
| QA-48 | `npm run qa:ollama` при запущенных Ollama и `npm run demo` | Живой планировщик возвращает валидные шаги, живая vision-модель даёт рекомендации, предупреждений `ИИ` нет | P1 |
| QA-49 | `npm run qa:ipc` в собранном приложении | Окно запускает прогон, показывает 9/9 и дефекты, кнопки JSON/Excel/HTML доступны | P0 |
| QA-50 | Официальный MCP-клиент по stdio | `initialize`, `tools/list`, `run_audit`, `list_reports`, `get_report`, `cancel`; без токена сервер не стартует | P1 |

## Воспроизводимость контрольных ошибок

### A. Отсутствует обратная связь при сохранении

1. Запустить Relay (`npm run demo`).
2. Выполнить предустановленный сценарий «Сохранение настроек».
3. Ожидается ошибка на `expectVisible css:[role="status"]`.
4. Исправление для теста: в `demo/index.html` при клике по `#save` вставить `role="status"` узел с видимым текстом.
5. Повторить аудит: этот шаг должен пройти.

### B. На мобильном нет действия возврата

1. Выполнить «Возврат на главную» на Desktop, Tablet и Mobile.
2. На Mobile (390px) click по `#back-home` не должен сработать, т.к. `.back {display:none}` при `max-width:520px`.
3. В `demo/index.html` удалите указанное правило, сохраните файл и перезапустите `npm run demo`.
4. Повторить: Mobile начинает проходить тот же сценарий.

## Качество результата на конкурсе

Необходимо хотя бы 1 видеозапись **настоящего исполнения**, файл `report.json`, 2 скриншота с привязкой к шагам, честный счёт TP/FP на контрольных дефектах, демонстрация реального исправления и повторного запуска. Важно: не создавать неподтверждённых метрик «95% точности».
