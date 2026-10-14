# DreamFrame context

## 2026-08-03 — сборка и тесты

### Проблема: pnpm не одобрял esbuild
- Причина: `package.json` использовал устаревшее поле `pnpm.onlyBuiltDependencies`, которое pnpm v11+ игнорирует; кроме того, `pnpm-workspace.yaml` содержал конфликтующий `allowBuilds: esbuild: false`.
- Решение: убрать поле `pnpm` из `package.json`, удалить `pnpm-workspace.yaml`, оставить `.npmrc` с `onlyBuiltDependencies=esbuild`.

### Проблема: TypeScript-ошибки в сервере/клиенте
- `ServerMessage` тип `snapshot` не допускал `null`.
- `error()` в `src/server/index.ts` принимала `string` вместо `ErrorCode`.
- `DreamFrameSource` ожидал строго `globalThis.WebSocket`, что ломало CLI с `ws`.
- Решение: обновить `types.ts`, добавить импорт `ErrorCode`, ввести `WebSocketLike`/`WebSocketCtorLike` для универсального конструктора WebSocket.

### Проблема: чистый клон падал с ERR_PNPM_IGNORED_BUILDS (esbuild)
- Причина: локально `node_modules` уже была, поэтому ошибка не проявлялась; в git не было разрешения сборки esbuild.
- Решение: `pnpm-workspace.yaml` с `allowBuilds: { esbuild: true }`. Проверено на чистом клоне: install, build, test — OK.

### Проблема: гонки сообщений в интеграционных тестах
- `register` удалял слушатель до получения начального `snapshot`, поэтому `nextMessage` иногда теряла сообщения.
- Решение: заменить хелперы на `MsgSocket` с внутренней очередью и единственным обработчиком `message`, не дублирующим события.

### Проблема: source получал собственный `change`
- Изначально `broadcastMessage` всегда слал сообщения активному source.
- Решение: `broadcastSnapshotChange` исключает source; `broadcastCommand` и `commandCleared` включают source. Source по умолчанию подписан только на `commands`.

### Проблема: commandAndCapture ждал скриншот, который source не присылал для custom action
- Причина: автоснимок срабатывал только для `action: 'screenshot'`.
- Решение: снимок делается после обработчиков для любой команды с `requestId` или `action: 'screenshot'`, если задан `captureScreenshot`.

### Проблема: скриншот и таймер регистрации
- `latestScreenshot` хранился в памяти без нужды → удалён из store/types.
- Таймер регистрации не очищался → очищается при `ready`.
