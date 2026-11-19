# UXProof

Windows-приложение для аудита веб-интерфейса по сценарию. Пользователь задаёт адрес и последовательность шагов. UXProof открывает Chromium, проходит эти шаги на трёх размерах экрана и записывает, какой шаг сорвался, с PNG и технической причиной.

Аудитория: инди-разработчик, небольшая студия, QA. Нативные Win32-окна и мобильные приложения в MVP не входят.

## Как устроено

Цепочка: React-интерфейс → Rust IPC → Node-runner (Playwright) → axe-core, горизонтальный overflow, JavaScript pageerror. Конфиг в sidecar уходит через stdin, не через `input.json`. Отчёт пишется в JSON, HTML и Excel. В Windows x64 MSI и NSIS лежат Node 24.14.1 и Chromium Headless Shell 1255 (SHA-256 манифест Chromium); системный Node для прогона не нужен. Debug-сборка берёт runner из checkout; release берёт runner из ресурсов пакета.

Один файловый замок `.audit.lock` в каталоге прогонов делят CLI, dev API и окно. Desktop держит lock на весь IPC-вызов и передаёт `UXPROOF_LOCK_HELD=1`, иначе CLI берёт тот же файл повторно. Отмена в окне: `cancel_audit` по PID. Закрытие окна во время аудита снимает Node и Chromium через Job Object `KILL_ON_JOB_CLOSE` (BUG-028).

Шаги вводит человек в редакторе (белый список типов, без `eval`). Модель может предложить черновик по тексту цели; список проходит тот же `validateConfig`, что и ручной ввод, и попадает в сценарий только по кнопке. Vision-модель смотрит скриншот и отдаёт до трёх замечаний класса `recommendation`. Они не смешиваются с `confirmed` (упавший Playwright-шаг, axe, overflow, pageerror).

URL до spawn проверяет и UI, и Rust: только `http(s)` без логина, без `file:` и `javascript:`. Во время прогона чужой loopback, link-local и адреса метаданных облака режутся; переход `navigate` ограничен origin проекта. Первый hop HTTP-redirect на другой origin прокси без MITM не останавливает.

## Поток в окне

Адрес и три готовых сценария Relay уже стоят. Три viewport: desktop, tablet, mobile. «Запустить аудит» открывает изолированный Chromium context на каждую пару сценарий×экран. Упавший шаг получает отдельный PNG до axe; конечный снимок прогона хранится отдельно. По желанию `trace: on-failure` пишет ZIP только для упавшего сценария (в нём могут быть DOM и сеть). История читает последние отчёты из app-data; битые JSON пропускаются, файлы не удаляются. Сравнение двух прогонов с одинаковым ключом конфигурации ставит `resolved` только ошибке шага, если все ранее упавшие комбинации прошли повторно.

Помимо axe, runner исполняет реестр `layout:viewport-overflow`, `layout:min-tap-target`, `layout:text-overflow`, `copy:duplicate-heading`, `copy:repeated-button-name`. Падение одного детектора не валит аудит.

Локальное демо Relay (`demo/`, `http://127.0.0.1:4180`) содержит намеренные дефекты: нет `role=status` после сохранения, «На главную» прячется на узком экране, JS-исключение в настройках, overflow, слабый контраст. Вариант `/fixed` закрывает эти сценарии в `test:fix`. MCP (`list_reports`, `run_audit`) смотрит тот же каталог через локальный dev API, без картинок.

## Что проверено 19 ноября 2026

- `npm run test:runner`: 128 тестов, 127 pass, 1 skip (HTTPS-прокси без Python `cryptography`).
- `cargo test`: 19/19, включая Job Object: sidecar Node и Chromium снимаются вместе с окном.
- `npm run build` прошёл.
- Smoke на Relay `/`: 5/9 комбинаций сценарий×экран (ожидаемые падения).
- `npm run test:fix` на `/fixed`: 9/9, 0 замечаний axe в этом прогоне.
- Живой Ollama: `npm run qa:ollama` (`qwen2.5vl:3b` на скриншот, `qwen2.5:3b` на план).
- Release-окно через WebView2 CDP (`npm run qa:ipc`): 9/9 сценариев на `/fixed`. В журнале UI могут остаться confirmed находки, которые не ломают шаг (например copy-правила).
- MSI ставился на машину `mono` (Windows 10, `msiexec /qn`, `C:\Program Files\UXProof`). Системного Node не было, аудит шёл bundled runtime. WebView2 на этой машине уже стоял.

Платный OpenAI не вызывался. GitHub CI в этом срезе не наблюдался глазами. Образ Windows без WebView2 не ставили.

## Ограничения

axe-core закрывает выбранные WCAG-теги. Ноль замечаний не равен полному WCAG. ИИ не судья: рекомендации субъективны, ключ не хранится во фронтенде, Ollama только на localhost. Скриншоты уходят во внешний API только если включён OpenAI.

MCP (`runner/mcp-server.mjs`) работает поверх локального dev API и не подключается к упакованному приложению.

Первый hop HTTP-redirect на чужой origin прокси без MITM не режет. Нет fuzzy UX-регрессий и агента, который сам обходит сайт. Runner выполняет указанные клики: отдельного запрета на покупку или удаление нет.

Закрытие окна во время аудита убивает дерево процессов через Windows Job Object (`KILL_ON_JOB_CLOSE`, BUG-028).

Исходники: https://github.com/Im-Krita/UxProof, ветка `main`. Как открыть локально: `docs/submission/03-demo.md`.
