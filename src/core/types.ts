import type * as THREE from 'three'

/**
 * DreamFrame — типы формата сцены для LLM.
 */

export interface Vec3 {
    x: number
    y: number
    z: number
}

export interface Bounds {
    min: Vec3
    max: Vec3
}

export interface SceneMeta {
    objectCount: number
    bounds: Bounds
}

export interface VisualProps {
    color?: string
    opacity?: number
    castShadow?: boolean
    receiveShadow?: boolean
}

export interface GeometryInfo {
    type: 'box' | 'sphere' | 'cylinder' | 'capsule' | 'plane' | 'cone' | 'ring' | 'custom'
    size?: Vec3
    radius?: number
    height?: number
}

export interface Relations {
    parent?: string
    children?: string[]
}

export interface TerrainSurfaceInfo {
    id: string
    kind: string
    origin: Vec3
    size: { x: number; z: number }
    cellSize: number
    thickness: number
    heights: number[][]
    mask?: boolean[][]
    color?: string
}

export interface TerrainVolumeInfo {
    id: string
    operation: 'union' | 'subtract'
    origin: Vec3
    size: Vec3
    cellSize: number
    density: number[][][]
    color?: string
}

export interface TerrainSceneInfo {
    size: number
    cellSize: number
    verticalRange: { min: number; max: number }
    surfaces: TerrainSurfaceInfo[]
    volumes: TerrainVolumeInfo[]
    resolution: { x: number; y: number; z: number }
}

export type ObjectKind =
    | 'player'
    | 'terrain'
    | 'obstacle'
    | 'light'
    | 'camera'
    | 'helper'
    | 'mesh'
    | 'group'

/**
 * Sub-kind для lights: разные классы Three.js получают разные русские подписи
 * (направленный/точечный/фоновый/прожектор).
 */
export type LightSubKind =
    | 'directional'
    | 'point'
    | 'ambient'
    | 'spot'
    | 'unknown'

export interface SceneObject {
    id: string
    kind: ObjectKind
    name: string
    position: Vec3
    rotation: Vec3
    scale: Vec3
    /** World-space axis-aligned dimensions. */
    size: Vec3
    /** World-space axis-aligned bounds. */
    bounds: Bounds
    /**
     * Описание объекта на русском, заданное разработчиком при интеграции
     * через `obj.userData.description` или `SerializerOptions.descriptionResolver`.
     */
    description: string
    /**
     * Подтип для света (directional/point/ambient/spot/unknown).
     * Заполняется только для `kind === 'light'`.
     */
    lightSubKind?: LightSubKind
    visual?: VisualProps
    geometry?: GeometryInfo
    relations?: Relations
    props?: Record<string, unknown>
    terrain?: TerrainSceneInfo
}

export interface Screenshot {
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
    data: string
    width: number
    height: number
    capturedAt: string
}

export interface CommandResult {
    requestId: string
    ok: boolean
    operation: string
    revision: number
    changed: boolean
    message: string
    data?: Record<string, unknown>
}

export interface SceneSnapshot {
    timestamp: string
    version: string
    meta: SceneMeta
    /**
     * Краткое текстовое описание сцены на русском: количество объектов,
     * границы и состав по kind с правильными plural-формами.
     */
    summary: string
    objects: SceneObject[]
}

export interface SerializerOptions {
    /** Включать helpers (GridHelper, AxesHelper) */
    includeHelpers?: boolean
    /** Минимальный размер объекта для включения */
    minSize?: number
    /** Дополнительная фильтрация объектов */
    filter?: (obj: THREE.Object3D) => boolean
    /** Кастомный определитель kind по имени/типу */
    kindResolver?: (obj: THREE.Object3D) => ObjectKind | undefined
    /** Пользовательская функция для получения описания объекта на русском */
    descriptionResolver?: (obj: THREE.Object3D) => string | undefined
}

// === WebSocket state-server protocol ===

/** Role of a WebSocket client inside a namespace. */
export type Role = 'source' | 'controller'

/** Topic names that can be subscribed to. */
export type Topic = 'snapshots' | 'commands' | 'screenshots' | 'results'

/** Operation kind for a command. */
export type CommandKind = 'one-shot' | 'active'

/**
 * Command = single action emitted by a controller and consumed by a source.
 * - `one-shot`: fire-and-forget (e.g. "focus camera").
 * - `active`: sticky; stored in `activeCommands` until explicitly cleared.
 */
export interface Command {
    id: string
    kind: CommandKind
    target?: string
    payload: Record<string, unknown>
    issuedAt: string
}

/** Client → Server messages. */
export type ClientMessage =
    | { type: 'register'; role: Role; namespace: string }
    | { type: 'putSnapshot'; snapshot: SceneSnapshot }
    | { type: 'putScreenshot'; requestId: string; screenshot: Screenshot }
    | { type: 'putResult'; result: CommandResult }
    | { type: 'snapshot' }
    | { type: 'subscribe'; topics: Topic[] }
    | { type: 'unsubscribe'; topics: Topic[] }
    | { type: 'command'; kind: CommandKind; payload: Record<string, unknown>; target?: string }
    | { type: 'clearCommand'; id: string }

/** Server → Client messages. */
export type ServerMessage =
    | { type: 'ready'; namespace: string; role: Role }
    | { type: 'snapshot'; snapshot: SceneSnapshot | null; activeCommands: Command[] }
    | { type: 'change'; snapshot: SceneSnapshot }
    | { type: 'screenshot'; requestId: string; screenshot: Screenshot }
    | { type: 'result'; result: CommandResult }
    | { type: 'command'; cmd: Command }
    | { type: 'commandCleared'; id: string }
    | { type: 'error'; code: ErrorCode; message: string }

/** Error codes used by the server. */
export type ErrorCode =
    | 'NOT_REGISTERED'
    | 'INVALID_MESSAGE'
    | 'WRONG_ROLE'
    | 'NO_SOURCE'
    | 'UNKNOWN_COMMAND'
    | 'INTERNAL'

/** Sink abstraction so the store can broadcast without coupling to `ws`. */
export interface MessageSink {
    send(message: ServerMessage): void
    close(): void
}

/** Pure namespace state — exposed for inspection and tests. */
export interface NamespaceState {
    snapshot: SceneSnapshot | null
    activeCommands: Map<string, Command>
    activeCommandCount: number
    latestScreenshot?: Screenshot
}

