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
} from './types.js'

export { serializeScene } from './serializer.js'
export {
    describeObject,
    colorToRussian,
    rotationToCompass,
    geometryToString,
    pluralRu,
    KIND_PLURALS,
} from './description.js'
export { buildSummary, buildSummaryParts } from './summary.js'
export { NamespaceStore } from './store.js'
