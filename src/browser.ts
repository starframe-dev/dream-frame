export { serializeScene } from './core/serializer.js'
export {
    describeObject,
    colorToRussian,
    rotationToCompass,
    geometryToString,
    pluralRu,
    KIND_PLURALS,
} from './core/description.js'
export { buildSummary, buildSummaryParts } from './core/summary.js'
export { DreamFrameSource } from './client/source.js'
export type { DreamFrameSourceOptions } from './client/source.js'

import type { Screenshot } from './core/types.js'

/** Capture a real browser canvas frame as a portable DreamFrame screenshot. */
export function captureCanvasScreenshot(canvas?: HTMLCanvasElement): Screenshot | null {
    const target = canvas ?? document.querySelector('canvas')
    if (!target) return null
    return {
        mimeType: 'image/png',
        data: target.toDataURL('image/png'),
        width: target.width,
        height: target.height,
        capturedAt: new Date().toISOString(),
    }
}

export type {
    Vec3,
    Bounds,
    SceneMeta,
    VisualProps,
    GeometryInfo,
    Relations,
    ObjectKind,
    LightSubKind,
    SceneObject,
    SceneSnapshot,
    Screenshot,
    SerializerOptions,
} from './core/types.js'
