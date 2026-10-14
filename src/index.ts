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
    CommandResult,
    SerializerOptions,
    Role,
    Topic,
    CommandKind,
    Command,
    ClientMessage,
    ServerMessage,
    ErrorCode,
    MessageSink,
    NamespaceState,
} from './core/types.js'

export {
    serializeScene,
    describeObject,
    colorToRussian,
    rotationToCompass,
    geometryToString,
    pluralRu,
    buildSummary,
    buildSummaryParts,
    NamespaceStore,
} from './core/index.js'

export { StateServer, statePath } from './server/index.js'
export { DreamFrameSource, DreamFrameController } from './client/index.js'
