# DreamFrame — WebSocket state-server протокол

## Версия

0.2.0

## Контекст

DreamFrame теперь — in-memory WebSocket state-сервер для Three.js сцен. Один сервер, много namespace-ов. Каждый namespace хранит последний `SceneSnapshot` и набор активных команд.

Роли:

- `source` — владелец сцены (браузерная вкладка/игра). Публикует snapshot. Только один source на namespace; новый source вытесняет старого.
- `controller` — читатель/аналитик (LLM/агент). Любое количество controller-ов. Читает snapshot, подписывается, отправляет команды.

## Модель данных

```ts
interface SceneSnapshot {
    timestamp: string
    version: string
    summary: string
    meta: {
        objectCount: number
        bounds: { min: Vec3; max: Vec3 }
    }
    objects: SceneObject[]
}

type CommandKind = 'one-shot' | 'active'

interface Command {
    id: string
    kind: CommandKind
    target?: string
    payload: Record<string, unknown>
    issuedAt: string
}

type Role = 'source' | 'controller'

type Topic = 'snapshots' | 'commands' | 'results' | 'screenshots'

interface CommandResult {
    requestId: string
    ok: boolean
    operation: string
    revision: number
    changed: boolean
    message: string
    data?: Record<string, unknown>
}

interface Screenshot {
    mimeType: 'image/png'
    data: string
    width: number
    height: number
    capturedAt: string
}
```

## Сообщения

### Client → Server

```ts
type ClientMessage =
    | { type: 'register'; role: Role; namespace: string }
    | { type: 'putSnapshot'; snapshot: SceneSnapshot }
    | { type: 'snapshot' }
    | { type: 'subscribe'; topics: Topic[] }
    | { type: 'unsubscribe'; topics: Topic[] }
    | { type: 'command'; kind: CommandKind; payload: Record<string, unknown>; target?: string }
    | { type: 'clearCommand'; id: string }
    | { type: 'putResult'; result: CommandResult }
    | { type: 'putScreenshot'; requestId: string; screenshot: Screenshot }
```

### Server → Client

```ts
type ServerMessage =
    | { type: 'ready'; namespace: string; role: Role }
    | { type: 'snapshot'; snapshot: SceneSnapshot; activeCommands: Command[] }
    | { type: 'change'; snapshot: SceneSnapshot }
    | { type: 'command'; cmd: Command }
    | { type: 'commandCleared'; id: string }
    | { type: 'result'; result: CommandResult }
    | { type: 'screenshot'; requestId: string; screenshot: Screenshot }
    | { type: 'error'; code: ErrorCode; message: string }

type ErrorCode =
    | 'NOT_REGISTERED'
    | 'INVALID_MESSAGE'
    | 'WRONG_ROLE'
    | 'NO_SOURCE'
    | 'UNKNOWN_COMMAND'
    | 'INTERNAL'
```

## Поведение

### Регистрация

Клиент должен первым сообщением отправить `register`. Сервер отвечает `ready` и сразу же `snapshot` (текущий snapshot + activeCommands). Если namespace ещё не существует, он создаётся.

### putSnapshot (source)

Полностью заменяет snapshot namespace. Текущий snapshot сохраняется; `activeCommands` не трогаются. Сервер отвечает `snapshot` инициатору. Подписчикам `snapshots` рассылается `change`.

### snapshot (controller)

Возвращает `snapshot` с текущим сценой и activeCommands. Не требует подписки.

### subscribe / unsubscribe

Controller может подписаться на `snapshots` (получать `change` при `putSnapshot`), `commands` (получать `command` / `commandCleared`), `results` и `screenshots`. Source автоматически подписан на все topic-и.

### command (controller)

Создаёт команду. `one-shot` — fire-and-forget, не сохраняется. `active` — сохраняется в `activeCommands`, пока не удалена через `clearCommand`. Сервер отправляет `command` source и подписчикам `commands`. Controller-инициатор получает `command` с заполненным `id`.

### clearCommand (controller)

Удаляет active-команду по id. source и подписчики `commands` получают `commandCleared`. Если id не найден — `error: UNKNOWN_COMMAND`.

### putResult / putScreenshot (source)

Source публикует результат обработки команды и PNG, связывая оба сообщения по `requestId`. Controller подписывается на `results` и `screenshots`; `commandAndWait` ждёт только результат, а `commandAndCapture` ждёт результат и соответствующий screenshot.

## Namespace isolation

Каждый namespace имеет независимое хранилище snapshot и команд. Два namespace-а не видят друг друга.

## Port discovery

Сервер, запущенный через CLI, пишет порт в файл:

```
/tmp/{slug}.dream.port
```

Controller / source клиенты могут искать URL по slug:

```ts
import { statePath } from '@starframe/dream-frame/server'
// или читать /tmp/{slug}.dream.port
```

## Ошибки

- `INVALID_MESSAGE` — невалидный JSON, отсутствует `type`, неизвестный `type`, или невалидные поля.
- `NOT_REGISTERED` — сообщение до `register`.
- `WRONG_ROLE` — source-only операция от controller или наоборот.
- `NO_SOURCE` — операция, требующая source, но source не подключён (например, если controller шлёт command, но source отсутствует — команда всё равно сохраняется, но source не получит; в текущей версии `NO_SOURCE` не используется, зарезервировано).
- `UNKNOWN_COMMAND` — `clearCommand` с неизвестным id.
- `INTERNAL` — непредвиденная ошибка сервера.

## Пример сессии

```
C→S: { "type": "register", "role": "source", "namespace": "demo" }
S→C: { "type": "ready", "namespace": "demo", "role": "source" }
S→C: { "type": "snapshot", "snapshot": { ... }, "activeCommands": [] }

C→S: { "type": "putSnapshot", "snapshot": { "version": "0.1.0", "summary": "...", ... } }
S→C: { "type": "snapshot", "snapshot": { ... }, "activeCommands": [] }

[controller подписывается]
S→C: { "type": "change", "snapshot": { ... } }

C→S: { "type": "command", "kind": "one-shot", "payload": { "action": "focus", "targetId": "player-1" } }
S→C: { "type": "command", "cmd": { "id": "...", "kind": "one-shot", "payload": { ... }, "issuedAt": "..." } }
```
