# DreamFrame: WebSocket state-сервер для Three.js сцен

## Контекст

`@starframe/dream-frame` сейчас сериализует Three.js сцену в `SceneSnapshot` (JSON + русские описания) и отдаёт его локально. Проект, который встраивает DreamFrame, может быть браузерной вкладкой. Агент/LLM, который анализирует сцену, живёт отдельно (Node-процесс, CLI, другой сервис). Нужно передавать снапшот сцены из вкладки агенту в реальном времени.

Решение: сделать DreamFrame по модели `rune-map` — in-memory WebSocket state-сервер с ролями, namespace-изоляцией и командами.

## Цель

Превратить `dream-frame` в работающий WebSocket state-сервер:

- `source` — браузерная вкладка/игра пушит `SceneSnapshot` в namespace.
- `controller` — LLM/агент читает snapshot, подписывается на изменения, отправляет команды обратно во вкладку.
- Один сервер обслуживает любые проекты; namespace (slug) изолирует данные.
- In-memory, без персистентности и авторизации.
- Браузерный `DreamFrameSource` и Node CLI для запуска сервера / controller.

## Что изменится

1. `SPEC.md` — этот документ заменяет предыдущую спецификацию.
2. `specs/scene-format.md` — остаётся актуальным описанием формата `SceneSnapshot`.
3. `specs/server.md` — новый документ с деталями WebSocket-протокола.
4. `package.json` — новые exports (`./core`, `./server`, `./client`), бинарь `dream-frame`, зависимости `ws`, `vitest`.
5. `tsconfig.json` — `module: NodeNext`, `moduleResolution: NodeNext` для рабочего ESM в Node 22.
6. `vitest.config.ts` — конфигурация тестов (pool: forks).
7. `src/core/` — сериализатор, типы, description/summary helpers (существующий код остаётся). Добавляется `store.ts` — in-memory хранилище snapshot-ов и команд.
8. `src/server/index.ts` — WebSocket `StateServer` с обработкой сообщений и авто-портом.
9. `src/client/index.ts` — CLI `dream-frame` (subcommands: server, source, controller).
10. `src/client/source.ts` — браузерный `DreamFrameSource` для вкладки.
11. `src/client/controller.ts` — программный `DreamFrameController` для агента.
12. `tests/integration.test.ts` — интеграционные тесты сервера.
13. `tests/browser-source.test.ts` — юнит-тесты браузерного source-клиента на мок WebSocket.

## Архитектура

```
┌─────────────────┐      WebSocket      ┌──────────────────┐      WebSocket      ┌──────────────────┐
│   source        │ ◄──────────────────► │  DreamFrame      │ ◄──────────────────► │   controller     │
│  (browser tab)  │   putSnapshot        │  StateServer     │   snapshot/subscribe │   (LLM agent)    │
│                 │                      │  + NamespaceStore│   command            │                  │
└─────────────────┘                      │                  │                      └──────────────────┘
                                         └──────────────────┘
```

## Роли

- `source` — единственный на namespace. Публикует `SceneSnapshot`. Может приходить graceful takeover (новый source вытесняет старого). Получает команды от controller.
- `controller` — любое количество. Читает snapshot, подписывается на `snapshots` / `commands` / `results` / `screenshots`, отправляет команды.

## Краткий протокол

### Client → Server

| type | role | назначение |
|------|------|------------|
| `register` | любая | `{ role, namespace }` — привязка соединения |
| `putSnapshot` | source | `{ snapshot: SceneSnapshot }` — полностью заменить сцену |
| `putResult` | source | `{ result: CommandResult }` — опубликовать результат команды |
| `putScreenshot` | source | `{ requestId, screenshot }` — опубликовать PNG команды |
| `snapshot` | controller | запросить текущий snapshot |
| `subscribe` | controller | `{ topics: ['snapshots' \| 'commands'] }` |
| `unsubscribe` | controller | `{ topics: [...] }` |
| `command` | controller | `{ kind: 'one-shot' \| 'active', payload, target? }` |
| `clearCommand` | controller | `{ id }` — отменить active-команду |

### Server → Client

| type | получатель | назначение |
|------|------------|------------|
| `ready` | любая | `{ namespace, role }` — подтверждение регистрации |
| `snapshot` | любая | `{ snapshot: SceneSnapshot, activeCommands: Command[] }` |
| `change` | подписчик `snapshots` | `{ snapshot: SceneSnapshot }` — дельта-уведомление |
| `result` | подписчик `results` | `{ result: CommandResult }` — результат source по requestId |
| `screenshot` | подписчик `screenshots` | `{ requestId, screenshot }` — актуальный кадр source |
| `command` | source + подписчики `commands` | `{ cmd: Command }` |
| `commandCleared` | source | `{ id }` |
| `error` | любая | `{ code, message }` |

Полная спецификация сообщений и типов — в `specs/server.md`.

## Публичный API

```ts
// Core (serializer + types)
import { serializeScene, describeObject, buildSummary } from '@starframe/dream-frame/core'

// Server (Node)
import { StateServer, statePath } from '@starframe/dream-frame/server'

// Browser source and Node controller clients
import { DreamFrameSource, DreamFrameController } from '@starframe/dream-frame/client'
```

## CLI

```bash
# запуск сервера (auto-port, пишет в /tmp/{slug}.dream.port)
dream-frame server --namespace demo

# source: читает snapshot из stdin и пушит в namespace
dream-frame source --namespace demo --input scene.json

# controller: получает snapshot и выходит
dream-frame controller --namespace demo

# controller: watch-режим
dream-frame controller --namespace demo --watch

# controller: интерактивный REPL
dream-frame controller --namespace demo --interactive
```

## Browser source client

```ts
import { DreamFrameSource, DreamFrameController } from '@starframe/dream-frame/client'

const source = new DreamFrameSource({ namespace: 'demo' })
await source.connect('ws://localhost:8080')
source.putSnapshot(serializeScene(scene))
source.onCommand(async (cmd) => {
    await source.putResult({
        requestId: String(cmd.payload.requestId),
        ok: true,
        operation: 'editor.example',
        revision: 1,
        changed: true,
        message: 'Готово'
    })
})

const controller = new DreamFrameController({ namespace: 'demo' })
const capture = await controller.commandAndCapture('one-shot', {
    action: 'editor',
    operation: 'editor.example'
})
```

## Критерии приёмки

- [ ] `pnpm build` собирается без ошибок TypeScript.
- [ ] `pnpm test` зелёный (интеграция + browser source).
- [ ] `dream-frame server --namespace demo` запускается, занимает свободный порт, пишет `/tmp/demo.dream.port`.
- [ ] `dream-frame controller --namespace demo` получает snapshot с `summary` и `objects`.
- [ ] `dream-frame source --namespace demo --input scene.json` пушит сцену.
- [ ] После `putSnapshot` controller-подписчик получает `change` с новым snapshot.
- [ ] `command` с `kind='one-shot'` транслируется `source` и не сохраняется.
- [ ] `command` с `kind='active'` сохраняется в `activeCommands`; `clearCommand` удаляет.
- [ ] Два namespace-а полностью изолированы.
- [ ] `DreamFrameSource` в браузере подключается, регистрируется, отправляет `putSnapshot`, получает команды.
- [ ] `specs/scene-format.md` и `specs/server.md` актуальны и отражают реализацию.
- [ ] `package.json` подготовлен к публикации (exports, bin, README, LICENSE, .gitignore, .npmignore).
