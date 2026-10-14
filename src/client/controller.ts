import WebSocket, { type RawData } from 'ws'
import { randomUUID } from 'node:crypto'
import type {
    SceneSnapshot,
    Screenshot,
    Command,
    CommandResult,
    Topic,
    Role,
    CommandKind,
} from '../core/types.js'

export interface DreamFrameControllerOptions {
    namespace: string
    url?: string
}

export type SnapshotHandler = (snapshot: SceneSnapshot | null, activeCommands: Command[]) => void
export type ChangeHandler = (snapshot: SceneSnapshot) => void
export type CommandHandler = (cmd: Command) => void
export type ScreenshotHandler = (screenshot: Screenshot, requestId: string) => void
export type ResultHandler = (result: CommandResult) => void

export interface CommandCapture {
    result: CommandResult
    screenshot: Screenshot
}

/**
 * Programmatic controller client for DreamFrame.
 *
 * Connects to a DreamFrame WebSocket server as a `controller`, reads snapshots,
 * subscribes to changes, and issues commands.
 */
export class DreamFrameController {
    readonly namespace: string
    private readonly url: string
    private socket?: WebSocket
    private resolveReady?: () => void
    private rejectReady?: (err: Error) => void
    private role: Role | null = null

    private snapshotHandlers = new Set<SnapshotHandler>()
    private changeHandlers = new Set<ChangeHandler>()
    private commandHandlers = new Set<CommandHandler>()
    private screenshotHandlers = new Set<ScreenshotHandler>()
    private resultHandlers = new Set<ResultHandler>()
    private screenshotWaiters = new Map<string, { resolve: (screenshot: Screenshot) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
    private resultWaiters = new Map<string, { resolve: (result: CommandResult) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()

    constructor(options: DreamFrameControllerOptions) {
        this.namespace = options.namespace
        this.url = options.url ?? 'ws://localhost:3002'
    }

    /** Connect and register as controller. */
    connect(url?: string): Promise<void> {
        const target = url ?? this.url
        return new Promise((resolve, reject) => {
            this.resolveReady = resolve
            this.rejectReady = reject

            const ws = new WebSocket(target)
            this.socket = ws

            ws.once('open', () => {
                ws.send(JSON.stringify({ type: 'register', role: 'controller', namespace: this.namespace }))
            })

            ws.on('message', (raw) => {
                this.handleMessage(raw)
            })

            ws.once('close', () => {
                this.rejectPending(new Error('WebSocket closed before registration completed'))
            })

            ws.once('error', (err) => {
                this.rejectPending(err)
            })

            setTimeout(() => {
                if (this.role !== 'controller') {
                    this.rejectPending(new Error('Registration timeout'))
                }
            }, 5000)
        })
    }

    /** Request current snapshot. */
    snapshot(): Promise<void> {
        return this.send({ type: 'snapshot' })
    }

    /** Subscribe to topics. */
    subscribe(topics: Topic[]): Promise<void> {
        return this.send({ type: 'subscribe', topics })
    }

    /** Unsubscribe from topics. */
    unsubscribe(topics: Topic[]): Promise<void> {
        return this.send({ type: 'unsubscribe', topics })
    }

    /** Issue a command. */
    command(kind: CommandKind, payload: Record<string, unknown>, target?: string): Promise<void> {
        return this.send({ type: 'command', kind, payload, target })
    }

    /** Issue a command and wait for its source result. */
    async commandAndWait(
        kind: CommandKind,
        payload: Record<string, unknown>,
        target?: string,
        timeoutMs = 10000
    ): Promise<CommandResult> {
        await this.subscribe(['results'])
        const requestId = typeof payload.requestId === 'string' ? payload.requestId : randomUUID()
        const commandPayload = { ...payload, requestId }
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.resultWaiters.delete(requestId)
                reject(new Error('Timed out waiting for command result'))
            }, timeoutMs)
            this.resultWaiters.set(requestId, { resolve, reject, timer })
            void this.command(kind, commandPayload, target).catch((error: unknown) => {
                clearTimeout(timer)
                this.resultWaiters.delete(requestId)
                reject(error instanceof Error ? error : new Error(String(error)))
            })
        })
    }

    /** Issue a command and wait for the source result plus its updated browser frame. */
    async commandAndCapture(
        kind: CommandKind,
        payload: Record<string, unknown>,
        target?: string,
        timeoutMs = 10000
    ): Promise<CommandCapture> {
        await this.subscribe(['results', 'screenshots'])
        const requestId = typeof payload.requestId === 'string' ? payload.requestId : randomUUID()
        const commandPayload = { ...payload, requestId }
        const resultPromise = new Promise<CommandResult>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.resultWaiters.delete(requestId)
                reject(new Error('Timed out waiting for command result'))
            }, timeoutMs)
            this.resultWaiters.set(requestId, { resolve, reject, timer })
        })
        const screenshotPromise = new Promise<Screenshot>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.screenshotWaiters.delete(requestId)
                reject(new Error('Timed out waiting for screenshot'))
            }, timeoutMs)
            this.screenshotWaiters.set(requestId, { resolve, reject, timer })
        })
        try {
            await this.command(kind, commandPayload, target)
            const [result, screenshot] = await Promise.all([resultPromise, screenshotPromise])
            return { result, screenshot }
        } catch (error: unknown) {
            const resultWaiter = this.resultWaiters.get(requestId)
            if (resultWaiter) {
                clearTimeout(resultWaiter.timer)
                this.resultWaiters.delete(requestId)
            }
            const screenshotWaiter = this.screenshotWaiters.get(requestId)
            if (screenshotWaiter) {
                clearTimeout(screenshotWaiter.timer)
                this.screenshotWaiters.delete(requestId)
            }
            throw error instanceof Error ? error : new Error(String(error))
        }
    }

    /** Request a screenshot from the active browser source. */
    async screenshot(timeoutMs = 10000): Promise<Screenshot> {
        await this.subscribe(['screenshots'])
        const requestId = randomUUID()
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.screenshotWaiters.delete(requestId)
                reject(new Error('Timed out waiting for screenshot'))
            }, timeoutMs)
            this.screenshotWaiters.set(requestId, { resolve, reject, timer })
            void this.command('one-shot', { action: 'screenshot', requestId }).catch((error: unknown) => {
                clearTimeout(timer)
                this.screenshotWaiters.delete(requestId)
                reject(error instanceof Error ? error : new Error(String(error)))
            })
        })
    }

    /** Clear an active command by id. */
    clearCommand(id: string): Promise<void> {
        return this.send({ type: 'clearCommand', id })
    }

    /** Register a handler for full snapshot responses. Returns unsubscribe. */
    onSnapshot(handler: SnapshotHandler): () => void {
        this.snapshotHandlers.add(handler)
        return () => this.snapshotHandlers.delete(handler)
    }

    /** Register a handler for `change` messages (requires `snapshots` subscription). Returns unsubscribe. */
    onChange(handler: ChangeHandler): () => void {
        this.changeHandlers.add(handler)
        return () => this.changeHandlers.delete(handler)
    }

    /** Register a handler for commands (requires `commands` subscription). Returns unsubscribe. */
    onCommand(handler: CommandHandler): () => void {
        this.commandHandlers.add(handler)
        return () => this.commandHandlers.delete(handler)
    }

    /** Register a handler for screenshots (requires `screenshots` subscription). */
    onScreenshot(handler: ScreenshotHandler): () => void {
        this.screenshotHandlers.add(handler)
        return () => this.screenshotHandlers.delete(handler)
    }

    /** Register a handler for operation results (requires `results` subscription). */
    onResult(handler: ResultHandler): () => void {
        this.resultHandlers.add(handler)
        return () => this.resultHandlers.delete(handler)
    }

    /** Close the connection. */
    close(): void {
        this.socket?.close()
        this.socket = undefined
        this.role = null
        for (const waiter of this.screenshotWaiters.values()) {
            clearTimeout(waiter.timer)
            waiter.reject(new Error('Controller closed'))
        }
        this.screenshotWaiters.clear()
        for (const waiter of this.resultWaiters.values()) {
            clearTimeout(waiter.timer)
            waiter.reject(new Error('Controller closed'))
        }
        this.resultWaiters.clear()
    }

    private send(message: Record<string, unknown>): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
                reject(new Error('Socket is not open'))
                return
            }
            this.socket.send(JSON.stringify(message), (err) => {
                if (err) reject(err)
                else resolve()
            })
        })
    }

    private handleMessage(raw: RawData): void {
        let message: Record<string, unknown>
        try {
            message = JSON.parse(raw.toString()) as Record<string, unknown>
        } catch {
            return
        }

        if (message.type === 'ready') {
            this.role = message.role as Role
            this.resolveReady?.()
            this.resolveReady = undefined
            this.rejectReady = undefined
            return
        }

        if (message.type === 'error') {
            this.rejectPending(new Error(`Server error: ${String(message.message)}`))
            return
        }

        if (message.type === 'snapshot') {
            const snapshot = message.snapshot as SceneSnapshot | null
            const activeCommands = (message.activeCommands as Command[]) ?? []
            for (const handler of this.snapshotHandlers) {
                try {
                    handler(snapshot, activeCommands)
                } catch {
                    // ignore
                }
            }
            return
        }

        if (message.type === 'change') {
            const snapshot = message.snapshot as SceneSnapshot
            for (const handler of this.changeHandlers) {
                try {
                    handler(snapshot)
                } catch {
                    // ignore
                }
            }
            return
        }

        if (message.type === 'screenshot') {
            const screenshot = message.screenshot as Screenshot
            const requestId = String(message.requestId)
            const waiter = this.screenshotWaiters.get(requestId)
            if (waiter) {
                clearTimeout(waiter.timer)
                this.screenshotWaiters.delete(requestId)
                waiter.resolve(screenshot)
            }
            for (const handler of this.screenshotHandlers) {
                try {
                    handler(screenshot, requestId)
                } catch {
                    // ignore handler errors
                }
            }
            return
        }

        if (message.type === 'result') {
            const result = message.result as CommandResult
            const waiter = this.resultWaiters.get(result.requestId)
            if (waiter) {
                clearTimeout(waiter.timer)
                this.resultWaiters.delete(result.requestId)
                waiter.resolve(result)
            }
            for (const handler of this.resultHandlers) {
                try {
                    handler(result)
                } catch {
                    // ignore handler errors
                }
            }
            return
        }

        if (message.type === 'command') {
            const cmd = message.cmd as Command
            for (const handler of this.commandHandlers) {
                try {
                    handler(cmd)
                } catch {
                    // ignore
                }
            }
            return
        }

        if (message.type === 'commandCleared') {
            // Controllers may ignore or react; no built-in default behavior.
            return
        }
    }

    private rejectPending(err: Error): void {
        this.rejectReady?.(err)
        this.resolveReady = undefined
        this.rejectReady = undefined
    }
}
