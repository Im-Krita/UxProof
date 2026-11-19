# Приёмка MSI на чистой Windows VM

Цель — проверить **release**-сборку там, где нет ни исходников, ни Node.js, ни
Chromium. Прогон `npm run tauri dev` этого не доказывает: в debug-сборке
[`select_runtime`](../src-tauri/src/lib.rs) берёт системный `node`, а
[`select_runner`](../src-tauri/src/lib.rs) — файлы из checkout.

## Предусловия

- Windows 10 22H2 или Windows 11, чистый образ без Node.js и Playwright.
- Проверить, что WebView2 отсутствует: `Get-Item 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\*'`.
- Установщик `UXProof_<версия>_x64_en-US.msi` из `src-tauri/target/release/bundle/msi/`.
- Тестовый сайт доступен с VM по HTTP (Relay из `demo/` или локальный сервер).
- В `PATH` нет `node`: `where node` ничего не находит.

## Чеклист

| # | Шаг | Ожидание | Статус |
|---|-----|----------|--------|
| 1 | Установить MSI двойным щелчком | Установка проходит, WebView2 ставится автоматически | 19.11.2026 `UXProof_0.1.0_x64_en-US.msi` на `mono` (`DESKTOP-VNV2VP5`, Win10 19045): `msiexec /qn` код 0, `C:\Program Files\UXProof\uxproof.exe`. WebView2 **уже был** (157.0.4341.46), автоустановку рантайма не наблюдали. Это не чистый образ |
| 2 | Запустить UXProof из меню «Пуск» | Окно открывается, версия в сайдбаре видна | Ярлык `C:\ProgramData\Microsoft\Windows\Start Menu\Programs\UXProof\UXProof.lnk`. Окно открыто через интерактивную задачу (SSH session 0 не рисует WebView2): сайдбар `v0.1.0` |
| 3 | `where node` в новом терминале | Ничего не найдено (runner использует встроенный Node) | `where node` пуст. Аудит шёл `C:\Program Files\UXProof\runtime\node.exe` и bundled Chromium Headless Shell 1255 |
| 4 | Импортировать `samples/demo.audit.json` | Проект загружается, сценарии и разрешения на месте | CDP: «Проект „Relay — демонстрационный аудит“ импортирован», сценарии на месте |
| 5 | Запустить аудит на Relay | Прогоны завершаются, отчёт открывается | `/fixed`: **9/9**, 3 подтверждённых дефекта, 0 a11y, JSON/Excel/HTML на месте |
| 6 | Открыть историю | Предыдущие прогоны видны, предупреждения о пропущенных записях нет | История: `19 нояб., 18:49 · 9/9 · Relay — IPC (приёмка)`, `skipped` нет |
| 7 | Открыть замечание с PNG | Скриншот грузится из `%APPDATA%\dev.uxproof.desktop\runs\<runId>\screenshots` | PNG на диске (`run-1-1.png` 27 КиБ и дальше), карточка замечания открывается |
| 8 | Нажать «Остановить» на долгом сценарии | Проверка останавливается, отчёт не пишется, окно остаётся живым | Кнопка «Остановить» возвращает «Запустить аудит», окно живо |
| 9 | Сразу запустить аудит снова | Новый прогон стартует, вечного 409 нет | Повторный старт сразу после стопа прошёл |
| 10 | Закрыть окно во время прогона | `UXProof.exe` завершается, `node.exe` и Chromium не висят в диспетчере задач | 19.11.2026 сначала **не прошло** (BUG-028). После Job Object: на `mono` `Stop-Process uxproof` во время прогона — через 8 с ни `node.exe`, ни `chrome-headless-shell.exe` |
| 11 | Включить «Сохранять trace при ошибке» и уронить шаг | В отчёте есть кнопка «Открыть trace», ZIP открывается Проводником | `/` дал 5/9, в отчёте видна ссылка/кнопка trace. ZIP в Проводнике с этой машины не открывали |
| 12 | Удалить `%APPDATA%\dev.uxproof.desktop\runs` и перезапустить | Приложение стартует, история пуста, ошибок нет | После удаления каталога: «История пуста», ошибок нет |

## Результат локального release-прогона (не VM)

19 ноября 2026 тот же release-бинарник (`src-tauri/target/release/uxproof.exe`) запускался на машине разработки с уже установленным WebView2. Окно управлялось через CDP (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333`) скриптом `npm run qa:ipc`:

- запуск аудита кнопкой в окне: 9/9 сценариев, 3 подтверждённых дефекта, 0 замечаний доступности;
- кнопки JSON, Excel и HTML-отчёта присутствуют, скриншот окна сохранён.

Пункты ниже всё ещё требуют чистой VM: установка MSI, автоматическая установка WebView2, отсутствие Node в `PATH`, поведение при закрытии окна во время прогона. На машине разработки есть системный Node и WebView2, поэтому этот прогон не заменяет их.

## Как повторить прогон окна

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9333"
Start-Process src-tauri\target\release\uxproof.exe
# в другом терминале: npm run demo (Relay на 4180) и затем
npm run qa:ipc
```

CDP даёт полный контроль над окном: средства скриншотов и `PrintWindow` для WebView2 возвращают пустое изображение, поэтому интерактивная проверка идёт через `chromium.connectOverCDP`.

## Известные пределы release-сборки

- Встроенные Node.js и Chromium (`resources/runtime`) увеличивают установщик.
  Если один из них отсутствует, аудит не стартует с сообщением
  «Переустановите приложение».
- В release-сборке на Windows `resource_dir()` возвращает verbatim-путь
  `\\?\D:\...`. Node не принимает его в качестве аргумента (`EISDIR: lstat 'D:'`),
  поэтому `plain_path` в `spawn.rs` снимает префикс перед запуском (BUG-025).
  Если менять запуск sidecar, этот тест обязателен.
- Rust держит `.audit.lock` на всё время IPC-вызова и передаёт дочернему процессу
  `UXPROOF_LOCK_HELD=1`, иначе CLI повторно берёт тот же lock и прогон падает с
  `ConflictError` (BUG-026).
- «Остановить» в окне Tauri вызывает `cancel_audit`: он завершает дерево
  процессов Node (вместе с Chromium). `AbortSignal` из
  [`bridge.ts`](../src/lib/bridge.ts) в Tauri **не** используется — это
  следствие IPC-модели, а не регрессия. В dev API отмена идёт через
  `AbortSignal` и `req.on('close')`.
- Первый HTTP-redirect на другой origin проходит через guard-proxy без MITM;
  HTTPS проверяется на уровне CONNECT, а не содержимого.
- Каталог прогонов можно переопределить переменной `UXPROOF_RUNS_DIR`; CLI,
  dev API и debug-сборка используют её одинаково, поэтому делят один lock.

## Как обновить статус

После прогона заменить «не проверено» на дату и версию MSI и сослаться на этот
файл в [`CORE-IMPLEMENTATION-STATUS.md`](CORE-IMPLEMENTATION-STATUS.md) §C01/C02.
Не отмечать пункт выполненным по результатам `npm run tauri dev`.

