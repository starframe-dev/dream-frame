#!/usr/bin/env node
import { WebSocketServer, type WebSocket } from 'ws'
import { writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { NamespaceStore } from '../core/store.js'
import type {
    ClientMessage,
    ServerMessage,
    Role,
    Topic,
    SceneSnapshot,
    Screenshot,
    CommandResult,
    CommandKind,
    MessageSink,
    ErrorCode,
} from '../core/types.js'

const STATE_DIR = '/tmp'

/** Slug-aware port file path (shared with the CLI client). */
export function statePath(slug: string): string {
    return join(STATE_DIR, `${slug}.dream.port`)
}

/** Per-connection state. */
interface Session {
    socket: WebSocket
    namespace?: string
    role?: Role
}

/**
 * DreamFrame WebSocket state server.
 *
 * One server process, many namespaces. Each WebSocket connection becomes a
 * `source` or `controller` for a namespace after `register`.
 */
export class StateServer {
    readonly port: number
    private readonly wss: WebSocketServer
    private readonly store = new NamespaceStore()
    private readonly sessions = new WeakMap<WebSocket, Session>()

    private constructor(port: number, wss: WebSocketServer) {
        this.port = port
        this.wss = wss
        this.wireConnection(wss)
        console.log(`[StateServer] listening on ws://localhost:${this.port}`)
    }

    /** Programmatic factory: bind on `port` (auto-pick if 0) and resolve once ready. */
    static create(opts: { port?: number; slug?: string } = {}): Promise<StateServer> {
        return new Promise((resolve, reject) => {
            const wss = new WebSocketServer({ port: opts.port ?? 0 })
            wss.once('listening', () => {
                const addr = wss.address()
                const port =
                    typeof addr === 'object' && addr ? addr.port : (opts.port ?? 0)
                const server = new StateServer(port, wss)
                if (opts.slug) {
                    const path = statePath(opts.slug)
                    const dir = dirname(path)
                    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
                    writeFileSync(path, String(port))
                    console.log(`[StateServer] wrote port ${port} to ${path}`)
                }
                resolve(server)
            })
            wss.once('error', reject)
        })
    }

    /** Underlying store — exposed for tests and integrations. */
    getStore(): NamespaceStore {
        return this.store
    }

    /** Stop accepting new connections and close the server. */
    stop(): Promise<void> {
        return new Promise((resolve) => this.wss.close(() => resolve()))
    }

    // === Wire-level plumbing ===

    private wireConnection(wss: WebSocketServer): void {
        wss.on('connection', (ws: WebSocket) => {
            const session: Session = { socket: ws }
            this.sessions.set(ws, session)

            ws.on('message', (raw) => {
                this.handleMessage(session, raw.toString())
            })

            ws.on('close', () => {
                this.store.unregister(toSink(ws))
            })

            ws.on('error', () => {
                // Errors on individual sockets are logged at the transport level
                // and handled through 'close'. Nothing to do here.
            })
        })
    }

    private handleMessage(session: Session, raw: string): void {
        let message: ClientMessage
        try {
            message = JSON.parse(raw) as ClientMessage
        } catch {
            this.send(session, error('INVALID_MESSAGE', 'Invalid JSON'))
            return
        }

        if (!message || typeof message !== 'object' || !('type' in message)) {
            this.send(session, error('INVALID_MESSAGE', 'Missing type'))
            return
        }

        try {
            switch (message.type) {
                case 'register':
                    this.handleRegister(session, message.namespace, message.role)
                    break
                case 'putSnapshot':
                    this.requireRole(session, 'source', () => {
                        const sink = toSink(session.socket)
                        this.store.putSnapshot(session.namespace!, message.snapshot as SceneSnapshot, sink)
                        this.sendSnapshot(session)
                    })
                    break
                case 'putScreenshot':
                    this.requireRole(session, 'source', () => {
                        const sink = toSink(session.socket)
                        this.store.putScreenshot(
                            session.namespace!,
                            message.requestId,
                            message.screenshot as Screenshot,
                            sink,
                        )
                    })
                    break
                case 'putResult':
                    this.requireRole(session, 'source', () => {
                        const sink = toSink(session.socket)
                        this.store.putResult(
                            session.namespace!,
                            message.result as CommandResult,
                            sink,
                        )
                    })
                    break
                case 'snapshot':
                    this.requireRegistered(session, () => {
                        this.sendSnapshot(session)
                    })
                    break
                case 'subscribe':
                    this.applySubscription(session, message.topics as Topic[], true)
                    break
                case 'unsubscribe':
                    this.applySubscription(session, message.topics as Topic[], false)
                    break
                case 'command':
                    this.requireRole(session, 'controller', () => {
                        const cmd = this.store.issueCommand(session.namespace!, {
                            kind: message.kind as CommandKind,
                            payload: message.payload,
                            target: message.target,
                        })
                        this.send(session, { type: 'command', cmd })
                    })
                    break
                case 'clearCommand':
                    this.requireRole(session, 'controller', () => {
                        const cleared = this.store.clearCommand(session.namespace!, message.id)
                        if (!cleared) {
                            this.send(session, error('UNKNOWN_COMMAND', `Unknown command id: ${message.id}`))
                        }
                    })
                    break
                default:
                    this.send(session, error('INVALID_MESSAGE', `Unknown message type: ${(message as { type?: unknown }).type ?? 'undefined'}`))
            }
        } catch (err) {
            const message2 = err instanceof Error ? err.message : String(err)
            this.send(session, error('INTERNAL', message2))
        }
    }

    private handleRegister(session: Session, namespace: string, role: Role): void {
        if (typeof namespace !== 'string' || namespace.length === 0) {
            this.send(session, error('INVALID_MESSAGE', 'Namespace required'))
            return
        }
        if (role !== 'source' && role !== 'controller') {
            this.send(session, error('INVALID_MESSAGE', 'Role must be source|controller'))
            return
        }

        // If re-registering as the same role, treat as no-op (send snapshot).
        if (session.namespace === namespace && session.role === role) {
            this.send(session, { type: 'ready', namespace, role })
            this.sendSnapshot(session)
            return
        }

        if (session.namespace) {
            this.send(session, error('WRONG_ROLE', 'Already registered'))
            return
        }

        session.namespace = namespace
        session.role = role
        this.store.register(namespace, role, toSink(session.socket))
        this.send(session, { type: 'ready', namespace, role })
        this.sendSnapshot(session)
    }

    private requireRegistered(session: Session, fn: () => void): void {
        if (!session.namespace || !session.role) {
            this.send(session, error('NOT_REGISTERED', 'Register first'))
            return
        }
        fn()
    }

    private requireRole(session: Session, expected: Role, fn: () => void): void {
        if (!session.namespace || !session.role) {
            this.send(session, error('NOT_REGISTERED', 'Register first'))
            return
        }
        if (session.role !== expected) {
            this.send(session, error('WRONG_ROLE', `Requires role=${expected}, got ${session.role}`))
            return
        }
        fn()
    }

    private applySubscription(session: Session, topics: Topic[], add: boolean): void {
        if (!session.namespace) {
            this.send(session, error('NOT_REGISTERED', 'Register first'))
            return
        }
        const sink = toSink(session.socket)
        const updated = add
            ? this.store.subscribe(sink, session.namespace, topics)
            : this.store.unsubscribe(sink, session.namespace, topics)
        this.sendSnapshot(session)
        void updated
    }

    private sendSnapshot(session: Session): void {
        if (!session.namespace) return
        const snap = this.store.snapshot(session.namespace)
        this.send(session, {
            type: 'snapshot',
            snapshot: snap.snapshot,
            activeCommands: snap.activeCommands,
        })
    }

    private send(session: Session, message: ServerMessage): void {
        if (session.socket.readyState !== session.socket.OPEN) return
        try {
            session.socket.send(JSON.stringify(message))
        } catch {
            // best-effort
        }
    }
}

// === Helpers ===

function error(code: ErrorCode, message: string): ServerMessage {
    return { type: 'error', code, message }
}

const sinkCache = new WeakMap<WebSocket, MessageSink>()

function toSink(socket: WebSocket): MessageSink {
    let sink = sinkCache.get(socket)
    if (!sink) {
        sink = {
            send(message: ServerMessage): void {
                if (socket.readyState !== socket.OPEN) return
                socket.send(JSON.stringify(message))
            },
            close(): void {
                try {
                    socket.close()
                } catch {
                    // ignore
                }
            },
        }
        sinkCache.set(socket, sink)
    }
    return sink
}
