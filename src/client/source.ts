import type { SceneSnapshot, Screenshot, Command, CommandResult, Role } from '../core/types.js'

/** Minimal WebSocket surface used by the browser source client. */
export interface WebSocketLike {
    readonly readyState: number
    send(data: string): void
    close(): void
    onopen: ((ev: Event) => void) | null
    onmessage: ((ev: MessageEvent) => void) | null
    onclose: ((ev: CloseEvent) => void) | null
    onerror: ((ev: Event) => void) | null
}

/** Constructor for a WebSocket-like transport. */
export interface WebSocketCtorLike {
    readonly CONNECTING: 0
    readonly OPEN: 1
    readonly CLOSING: 2
    readonly CLOSED: 3
    new (url: string): WebSocketLike
}

export interface DreamFrameSourceOptions {
    namespace: string
    /** WebSocket constructor override (defaults to `globalThis.WebSocket`). */
    WebSocket?: WebSocketCtorLike
    /** Captures the real application frame when a controller requests a screenshot. */
    captureScreenshot?: () => Screenshot | Promise<Screenshot | null> | null
}

export type CommandHandler = (cmd: Command) => void

/**
 * Browser-friendly source client for DreamFrame.
 *
 * Connects to a DreamFrame WebSocket server as a `source`, publishes snapshots,
 * and receives commands from controllers.
 */
export class DreamFrameSource {
    readonly namespace: string
    private readonly WebSocketCtor: WebSocketCtorLike
    private readonly captureScreenshot?: DreamFrameSourceOptions['captureScreenshot']
    private socket?: WebSocketLike
    private handlers = new Set<CommandHandler>()
    private resolveReady?: () => void
    private rejectReady?: (err: Error) => void
    private role: Role | null = null
    private registrationTimer?: ReturnType<typeof setTimeout>

    constructor(options: DreamFrameSourceOptions) {
        this.namespace = options.namespace
        const ctor = options.WebSocket ?? globalThis.WebSocket
        if (!ctor) {
            throw new Error('WebSocket is not available. Pass WebSocket in options.')
        }
        this.WebSocketCtor = ctor
        this.captureScreenshot = options.captureScreenshot
    }

    /** Connect and register as source. Resolves when `ready` is received. */
    connect(url: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.resolveReady = resolve
            this.rejectReady = reject

            const socket = new this.WebSocketCtor(url)
            this.socket = socket as WebSocketLike

            socket.onopen = () => {
                this.send({ type: 'register', role: 'source', namespace: this.namespace })
            }

            socket.onmessage = (event) => {
                this.handleMessage(event.data)
            }

            socket.onclose = () => {
                this.rejectPending(new Error('WebSocket closed before registration completed'))
            }

            socket.onerror = () => {
                this.rejectPending(new Error('WebSocket error'))
            }

            // Safety timeout, cleared once registration succeeds.
            this.registrationTimer = setTimeout(() => {
                if (this.role !== 'source') {
                    this.rejectPending(new Error('Registration timeout'))
                }
            }, 5000)
        })
    }

    /** Publish a new scene snapshot. */
    putSnapshot(snapshot: SceneSnapshot): Promise<void> {
        return this.send({ type: 'putSnapshot', snapshot })
    }

    /** Publish an operation result to controllers subscribed to results. */
    putResult(result: CommandResult): Promise<void> {
        return this.send({ type: 'putResult', result })
    }

    /** Publish a captured screenshot to controllers subscribed to screenshots. */
    putScreenshot(requestId: string, screenshot: Screenshot): Promise<void> {
        return this.send({ type: 'putScreenshot', requestId, screenshot })
    }

    /** Subscribe to commands from controllers. Returns unsubscribe function. */
    onCommand(handler: CommandHandler): () => void {
        this.handlers.add(handler)
        return () => {
            this.handlers.delete(handler)
        }
    }

    /** Close the connection. */
    close(): void {
        this.socket?.close()
        this.socket = undefined
        this.role = null
    }

    private send(message: Record<string, unknown>): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.socket || this.socket.readyState !== this.WebSocketCtor.OPEN) {
                reject(new Error('Socket is not open'))
                return
            }
            try {
                this.socket.send(JSON.stringify(message))
                resolve()
            } catch (err) {
                reject(err instanceof Error ? err : new Error(String(err)))
            }
        })
    }

    private handleMessage(raw: unknown): void {
        let message: Record<string, unknown>
        try {
            message = JSON.parse(typeof raw === 'string' ? raw : String(raw)) as Record<string, unknown>
        } catch {
            return
        }

        if (message.type === 'ready') {
            this.role = message.role as Role
            clearTimeout(this.registrationTimer)
            this.registrationTimer = undefined
            this.resolveReady?.()
            this.resolveReady = undefined
            this.rejectReady = undefined
            return
        }

        if (message.type === 'error') {
            const err = new Error(`Server error: ${String(message.message)}`)
            this.rejectPending(err)
            return
        }

        if (message.type === 'command') {
            const cmd = message.cmd as Command
            for (const handler of this.handlers) {
                try {
                    handler(cmd)
                } catch {
                    // ignore handler errors
                }
            }
            // Capture after handlers ran, so the frame reflects the command.
            if (this.captureScreenshot && this.isScreenshotRequest(cmd)) {
                void this.captureAndSendScreenshot(cmd).catch((error: unknown) => {
                    console.error('[dream-frame] screenshot failed:', error)
                })
            }
            return
        }

        if (message.type === 'commandCleared') {
            // Source can optionally react; no built-in default behavior.
            return
        }
    }

    /** A command requests a frame when it is a `screenshot` action or carries a `requestId` (commandAndCapture). */
    private isScreenshotRequest(cmd: Command): boolean {
        return cmd.payload.action === 'screenshot' || typeof cmd.payload.requestId === 'string'
    }

    private async captureAndSendScreenshot(cmd: Command): Promise<void> {
        if (!this.captureScreenshot) return
        const requestId = typeof cmd.payload.requestId === 'string' ? cmd.payload.requestId : cmd.id
        const screenshot = await this.captureScreenshot()
        if (!screenshot) return
        await this.send({ type: 'putScreenshot', requestId, screenshot })
    }

    private rejectPending(err: Error): void {
        this.rejectReady?.(err)
        this.resolveReady = undefined
        this.rejectReady = undefined
    }
}
