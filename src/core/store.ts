import { randomUUID } from 'node:crypto'
import type {
    SceneSnapshot,
    Screenshot,
    CommandResult,
    Command,
    CommandKind,
    Topic,
    Role,
    ServerMessage,
    MessageSink,
    NamespaceState,
} from './types.js'

/**
 * Per-namespace runtime state held by the store.
 * Sinks are the transport-agnostic outbound channels.
 */
interface NamespaceRuntime {
    snapshot: SceneSnapshot | null
    activeCommands: Map<string, Command>
    latestScreenshot?: Screenshot
    /** Single active source sink (graceful takeover replaces it). */
    source?: MessageSink
    controllers: Set<MessageSink>
    /** Per-sink subscription set (snapshots / commands). */
    subscriptions: Map<MessageSink, Set<Topic>>
}

/**
 * In-memory multi-tenant store for the DreamFrame server.
 *
 * Holds namespaces independently. Provides pure operations
 * (putSnapshot/snapshot/commands) and broadcast hooks that take
 * `MessageSink` — decoupled from any specific transport.
 */
export class NamespaceStore {
    private namespaces = new Map<string, NamespaceRuntime>()

    /** Lazily create a namespace runtime. */
    private ns(namespace: string): NamespaceRuntime {
        let runtime = this.namespaces.get(namespace)
        if (!runtime) {
            runtime = {
                snapshot: null,
                activeCommands: new Map(),
                latestScreenshot: undefined,
                controllers: new Set(),
                subscriptions: new Map(),
            }
            this.namespaces.set(namespace, runtime)
        }
        return runtime
    }

    /** Snapshot of a namespace for inspection/tests. */
    inspect(namespace: string): NamespaceState | null {
        const runtime = this.namespaces.get(namespace)
        if (!runtime) return null
        return {
            snapshot: runtime.snapshot,
            activeCommands: new Map(runtime.activeCommands),
            activeCommandCount: runtime.activeCommands.size,
            latestScreenshot: runtime.latestScreenshot,
        }
    }

    /** Names of all currently-known namespaces. */
    namespaces_(): string[] {
        return Array.from(this.namespaces.keys())
    }

    // === Registration ===

    /**
     * Register a sink in a namespace with the given role.
     * For `source`: replaces the existing source (graceful takeover — old is closed).
     * Returns true if this sink is the active source after registration
     * (false if it was a controller).
     */
    register(namespace: string, role: Role, sink: MessageSink): boolean {
        const runtime = this.ns(namespace)
        if (role === 'source') {
            if (runtime.source && runtime.source !== sink) {
                // Graceful takeover — close the previous source.
                try {
                    runtime.source.close()
                } catch {
                    // ignore — best effort
                }
            }
            runtime.source = sink
            runtime.subscriptions.set(sink, new Set(['commands']))
            return true
        }
        runtime.controllers.add(sink)
        runtime.subscriptions.set(sink, new Set())
        return false
    }

    /** Remove a sink (called on disconnect). */
    unregister(sink: MessageSink): void {
        for (const [namespace, runtime] of this.namespaces) {
            if (runtime.source === sink) {
                runtime.source = undefined
                runtime.subscriptions.delete(sink)
                // Active commands are cleared because no source consumes them.
                if (runtime.activeCommands.size > 0) {
                    runtime.activeCommands.clear()
                }
                this.dropIfEmpty(namespace, runtime)
                continue
            }
            if (runtime.controllers.delete(sink)) {
                runtime.subscriptions.delete(sink)
                this.dropIfEmpty(namespace, runtime)
                continue
            }
        }
    }

    private dropIfEmpty(namespace: string, runtime: NamespaceRuntime): void {
        if (
            runtime.snapshot === null &&
            runtime.activeCommands.size === 0 &&
            runtime.controllers.size === 0 &&
            !runtime.source
        ) {
            this.namespaces.delete(namespace)
        }
    }

    // === Snapshot operations (source role only) ===

    /** Replace the stored snapshot for a namespace. */
    putSnapshot(namespace: string, snapshot: SceneSnapshot, sourceSink: MessageSink): void {
        const runtime = this.ns(namespace)
        if (runtime.source !== sourceSink) {
            throw new Error('Only the active source can put a snapshot')
        }
        runtime.snapshot = snapshot
        this.broadcastSnapshotChange(runtime)
    }

    /** Build a full snapshot payload. */
    snapshot(namespace: string): { snapshot: SceneSnapshot | null; activeCommands: Command[] } {
        const runtime = this.namespaces.get(namespace)
        return {
            snapshot: runtime?.snapshot ?? null,
            activeCommands: runtime
                ? Array.from(runtime.activeCommands.values())
                : [],
        }
    }

    // === Screenshots ===

    /** Accept a screenshot from the active browser source and broadcast it. */
    putScreenshot(namespace: string, requestId: string, screenshot: Screenshot, sourceSink: MessageSink): void {
        const runtime = this.ns(namespace)
        if (runtime.source !== sourceSink) {
            throw new Error('Only the active source can put a screenshot')
        }
        runtime.latestScreenshot = screenshot
        this.broadcastMessage(runtime, 'screenshots', {
            type: 'screenshot',
            requestId,
            screenshot,
        }, false)
    }

    /** Accept an operation result from the active browser source and broadcast it. */
    putResult(namespace: string, result: CommandResult, sourceSink: MessageSink): void {
        const runtime = this.ns(namespace)
        if (runtime.source !== sourceSink) {
            throw new Error('Only the active source can put a result')
        }
        this.broadcastMessage(runtime, 'results', {
            type: 'result',
            result,
        }, false)
    }

    // === Commands ===

    /** Issue a command. `active` commands are stored; `one-shot` are not. */
    issueCommand(
        namespace: string,
        args: {
            kind: CommandKind
            payload: Record<string, unknown>
            target?: string
        }
    ): Command {
        const runtime = this.ns(namespace)
        const cmd: Command = {
            id: randomUUID(),
            kind: args.kind,
            payload: args.payload,
            target: args.target,
            issuedAt: new Date().toISOString(),
        }
        if (cmd.kind === 'active') {
            runtime.activeCommands.set(cmd.id, cmd)
        }
        this.broadcastCommand(runtime, cmd)
        return cmd
    }

    /** Clear an active command by id. Returns true if removed. */
    clearCommand(namespace: string, commandId: string): boolean {
        const runtime = this.namespaces.get(namespace)
        if (!runtime) return false
        const had = runtime.activeCommands.delete(commandId)
        if (had) {
            this.broadcastMessage(runtime, 'commands', {
                type: 'commandCleared',
                id: commandId,
            }, true)
        }
        return had
    }

    // === Subscriptions ===

    /** Add topic subscriptions for a sink. Returns the resulting topic set. */
    subscribe(sink: MessageSink, namespace: string, topics: Topic[]): Set<Topic> {
        const runtime = this.ns(namespace)
        const set = runtime.subscriptions.get(sink)
        if (!set) return new Set()
        for (const topic of topics) set.add(topic)
        return new Set(set)
    }

    /** Remove topic subscriptions for a sink. */
    unsubscribe(sink: MessageSink, namespace: string, topics: Topic[]): Set<Topic> {
        const runtime = this.ns(namespace)
        const set = runtime.subscriptions.get(sink)
        if (!set) return new Set()
        for (const topic of topics) set.delete(topic)
        return new Set(set)
    }

    // === Broadcast helpers ===

    /** Broadcast snapshot change to controllers subscribed to `snapshots`. Source is excluded. */
    private broadcastSnapshotChange(runtime: NamespaceRuntime): void {
        if (!runtime.snapshot) return
        const message: ServerMessage = {
            type: 'change',
            snapshot: runtime.snapshot,
        }
        this.broadcastMessage(runtime, 'snapshots', message, false)
    }

    /** Broadcast a command to the source + command-subscribed controllers. */
    private broadcastCommand(runtime: NamespaceRuntime, cmd: Command): void {
        this.broadcastMessage(runtime, 'commands', { type: 'command', cmd }, true)
    }

    /**
     * Dispatch a server message to all sinks subscribed to the topic.
     * Source is included only when `includeSource` is true.
     */
    private broadcastMessage(
        runtime: NamespaceRuntime,
        topic: Topic,
        message: ServerMessage,
        includeSource: boolean
    ): void {
        if (includeSource && runtime.source) {
            this.safeSend(runtime.source, message)
        }
        for (const [sink, topics] of runtime.subscriptions) {
            if (sink === runtime.source) continue
            if (!topics.has(topic)) continue
            this.safeSend(sink, message)
        }
    }

    /** Send a message to a single sink, swallowing transport errors. */
    private safeSend(sink: MessageSink, message: ServerMessage): void {
        try {
            sink.send(message)
        } catch (err) {
            // Swallow — a broken sink should not break the store.
            // The transport layer is responsible for cleanup.
            void err
        }
    }
}
