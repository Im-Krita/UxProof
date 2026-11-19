# Демонстрация

Публичного SaaS и MSI в GitHub Releases нет. GitHub даёт исходники. Живой UXProof запускается на Windows у себя.

## Код

https://github.com/Im-Krita/UxProof  
Ветка с текущим срезом: `main`.

Репозиторий не является работающим приложением: клонирование само по себе окно не открывает.

## Живой продукт (Windows)

Два процесса: тестовый сайт Relay и само приложение.

```powershell
npm install
cd runner
npm install
npx playwright install chromium
cd ..
```

Терминал 1:

```powershell
npm run demo
```

Relay слушает `http://127.0.0.1:4180`. Исправленный вариант: `http://127.0.0.1:4180/fixed`. Маршруты отдаёт `demo/server.mjs`. Статический хостинг без этого сервера на `/fixed` отвечает 404.

Терминал 2, разработка:

```powershell
npm run tauri
```

Либо `npm run dev` и браузер `http://127.0.0.1:1420` (тот же runner, без окна Tauri).

Либо установленный MSI (`C:\Program Files\UXProof` на машине `mono`, 19.11.2026). Для аудита системный Node не нужен.

В окне адрес Relay уже стоит. «Запустить аудит» гоняет Playwright по сценариям × трём viewport. На `/` ожидаются падения (smoke 5/9). На `/fixed` `test:fix` даёт 9/9 и 0 axe в этом прогоне.

## Что смотреть

Relay это цель аудита, не UXProof. Намеренные дефекты: нет статуса после сохранения, скрытая «На главную» на узком экране, исключение в настройках, overflow, контраст.

Готовый сценарий: `samples/demo.audit.json`.

Сквозной прогон в собранном окне (нужны Relay и release-сборка): `npm run qa:ipc`.
