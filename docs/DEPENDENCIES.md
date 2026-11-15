# Готовые исходники, библиотеки и лицензии

Пользовательское требование — не переписывать общеизвестные инструменты с нуля. Используются готовые широко применяемые open-source библиотеки. Здесь не включены копии их исходников: они устанавливаются через npm/Cargo из официальных реестров.

| Компонент | Функция | Первоисточник |
|---|---|---|
| Tauri 2 / `tauri-build` | Windows desktop shell, безопасные IPC-команды | https://v2.tauri.app/ |
| React / React DOM | Интерфейс, интерактивный редактор шагов | https://react.dev/ |
| TypeScript, Vite | Типизация, сборка frontend | https://www.typescriptlang.org/ , https://vite.dev/ |
| Playwright | Кроссбраузерная автоматизация, locator API, скриншоты | https://playwright.dev/docs/intro |
| `@axe-core/playwright` | Accessibility engine axe для Playwright | https://www.npmjs.com/package/@axe-core/playwright |
| Lucide React | Локально встраиваемые иконки | https://lucide.dev/ |
| OpenAI Responses API | Cloud multimodal model review (опционально) | https://developers.openai.com/api/docs/guides/images-vision |
| Ollama `/api/chat` | Локальная мультимодальная модель (опционально) | https://docs.ollama.com/api/chat |

- Проверяйте актуальные лицензии и тексты NOTICE на момент коммерческой поставки. В частности Playwright распространяется под Apache-2.0, axe-core и его обёртка используют условия MPL-2.0; React и Lucide обычно используют MIT. Эти сведения требуют проверки в установленной версии перед релизом.
- В архиве отсутствуют материалы и бинарные дистрибутивы сторонних авторов, только оригинальный glue-код и конфигурация использования библиотек.
- Не утверждается, что UXProof не имеет аналогов. Playwright и axe уже хорошо решают часть проверки, сравнивать конкурентоспособность надо по UX-процессу и воспроизводимости.

## Что не стоит делать самому на хакатоне

1. Писать собственный браузер, CSS-движок или WebDriver.
2. Писать с нуля WCAG rule engine.
3. Создавать самодельный Node runtime и Chromium packager без тестирования на Windows.
4. Делать самостоятельный LLM inference runtime вместо подключения к готовому API/Ollama.

## Возможная эволюция

Вместо прямого Node CLI можно создать Rust-оркестратор + упакованный sidecar Node/Playwright. Для этого Tauri имеет официальный механизм external binaries: https://v2.tauri.app/develop/sidecar/. Это задача v0.2, а не подтверждённая функция текущего MVP.
