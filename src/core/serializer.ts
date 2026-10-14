import * as THREE from 'three'
import { buildSummary } from './summary.js'
import type {
    SceneSnapshot,
    SceneObject,
    Vec3,
    Bounds,
    ObjectKind,
    LightSubKind,
    GeometryInfo,
    VisualProps,
    SerializerOptions,
    TerrainSceneInfo,
} from './types.js'

const VERSION = '0.1.0'

function vec3(v: THREE.Vector3): Vec3 {
    return { x: v.x, y: v.y, z: v.z }
}

function euler(e: THREE.Euler): Vec3 {
    return { x: e.x, y: e.y, z: e.z }
}

function emptyBounds(): Bounds {
    return {
        min: { x: Infinity, y: Infinity, z: Infinity },
        max: { x: -Infinity, y: -Infinity, z: -Infinity },
    }
}

function expandBounds(b: Bounds, v: Vec3): void {
    b.min.x = Math.min(b.min.x, v.x)
    b.min.y = Math.min(b.min.y, v.y)
    b.min.z = Math.min(b.min.z, v.z)
    b.max.x = Math.max(b.max.x, v.x)
    b.max.y = Math.max(b.max.y, v.y)
    b.max.z = Math.max(b.max.z, v.z)
}

function getWorldBounds(obj: THREE.Object3D, position: THREE.Vector3): Bounds {
    const box = new THREE.Box3().setFromObject(obj)
    if (box.isEmpty()) {
        const point = vec3(position)
        return { min: point, max: { ...point } }
    }

    return {
        min: vec3(box.min),
        max: vec3(box.max),
    }
}

function boundsSize(bounds: Bounds): Vec3 {
    return {
        x: bounds.max.x - bounds.min.x,
        y: bounds.max.y - bounds.min.y,
        z: bounds.max.z - bounds.min.z,
    }
}

function getKind(obj: THREE.Object3D, resolver?: SerializerOptions['kindResolver']): ObjectKind {
    if (resolver) {
        const resolved = resolver(obj)
        if (resolved) return resolved
    }

    const name = obj.name.toLowerCase()

    if (obj instanceof THREE.GridHelper || obj instanceof THREE.AxesHelper) {
        return 'helper'
    }
    if (obj instanceof THREE.DirectionalLight || obj instanceof THREE.AmbientLight || obj instanceof THREE.PointLight || obj instanceof THREE.SpotLight) {
        return 'light'
    }
    if (obj instanceof THREE.PerspectiveCamera || obj instanceof THREE.OrthographicCamera) {
        return 'camera'
    }

    if (name.includes('player') || name.includes('hero') || name.includes('character')) {
        return 'player'
    }
    if (name.includes('terrain') || name.includes('ground') || name.includes('floor')) {
        return 'terrain'
    }
    if (name.includes('obstacle') || name.includes('wall') || name.includes('block')) {
        return 'obstacle'
    }

    if (obj instanceof THREE.Mesh) {
        return 'mesh'
    }

    return 'group'
}

function getLightSubKind(obj: THREE.Object3D): LightSubKind | undefined {
    if (obj instanceof THREE.DirectionalLight) return 'directional'
    if (obj instanceof THREE.PointLight) return 'point'
    if (obj instanceof THREE.AmbientLight) return 'ambient'
    if (obj instanceof THREE.SpotLight) return 'spot'
    return 'unknown'
}

function extractGeometry(mesh: THREE.Mesh): GeometryInfo | undefined {
    const geo = mesh.geometry

    if (geo instanceof THREE.BoxGeometry) {
        return {
            type: 'box',
            size: {
                x: geo.parameters.width,
                y: geo.parameters.height,
                z: geo.parameters.depth,
            },
        }
    }

    if (geo instanceof THREE.SphereGeometry) {
        return {
            type: 'sphere',
            radius: geo.parameters.radius,
        }
    }

    if (geo instanceof THREE.CylinderGeometry) {
        return {
            type: 'cylinder',
            radius: geo.parameters.radiusTop,
            height: geo.parameters.height,
        }
    }

    if (geo instanceof THREE.CapsuleGeometry) {
        return {
            type: 'capsule',
            radius: geo.parameters.radius,
            height: geo.parameters.length,
        }
    }

    if (geo instanceof THREE.PlaneGeometry) {
        return {
            type: 'plane',
            size: {
                x: geo.parameters.width,
                y: 0,
                z: geo.parameters.height,
            },
        }
    }

    if (geo instanceof THREE.ConeGeometry) {
        return {
            type: 'cone',
            radius: geo.parameters.radius,
            height: geo.parameters.height,
        }
    }

    if (geo instanceof THREE.RingGeometry) {
        return {
            type: 'ring',
            radius: geo.parameters.outerRadius,
        }
    }

    return { type: 'custom' }
}

function extractVisual(mesh: THREE.Mesh): VisualProps | undefined {
    const mat = mesh.material
    if (!mat) return undefined

    const visual: VisualProps = {}

    if (Array.isArray(mat)) {
        const first = mat[0]
        if (first instanceof THREE.MeshStandardMaterial || first instanceof THREE.MeshBasicMaterial) {
            visual.color = '#' + first.color.getHexString()
            if ('opacity' in first) {
                visual.opacity = (first as THREE.MeshStandardMaterial).opacity
            }
        }
    } else {
        if (mat instanceof THREE.MeshStandardMaterial || mat instanceof THREE.MeshBasicMaterial) {
            visual.color = '#' + mat.color.getHexString()
            visual.opacity = mat.opacity
        }
    }

    visual.castShadow = mesh.castShadow
    visual.receiveShadow = mesh.receiveShadow

    return visual
}

/**
 * Serialize a Three.js scene into a structured snapshot.
 *
 * Каждый объект получает поле `description` (русским текстом),
 * сцена в целом — поле `summary` с количеством объектов, границами
 * и разбивкой по kind.
 */
export function serializeScene(
    scene: THREE.Scene,
    options: SerializerOptions = {}
): SceneSnapshot {
    const {
        includeHelpers = true,
        minSize = 0.001,
        filter,
        kindResolver,
        descriptionResolver,
    } = options

    const objects: SceneObject[] = []
    const bounds = emptyBounds()

    scene.traverse((obj) => {
        // Skip the scene root itself
        if (obj === scene) return

        // Filter
        if (filter && !filter(obj)) return

        const kind = getKind(obj, kindResolver)

        // Skip helpers if not included
        if (kind === 'helper' && !includeHelpers) return

        // Skip invisible
        if (!obj.visible) return

        const worldPos = new THREE.Vector3()
        obj.getWorldPosition(worldPos)
        const worldBounds = getWorldBounds(obj, worldPos)
        const objectSize = boundsSize(worldBounds)

        // Size check for meshes
        if (obj instanceof THREE.Mesh) {
            if (objectSize.x < minSize && objectSize.y < minSize && objectSize.z < minSize) return
        }

        const worldQuat = new THREE.Quaternion()
        obj.getWorldQuaternion(worldQuat)
        const rotEuler = new THREE.Euler().setFromQuaternion(worldQuat)

        const worldScale = new THREE.Vector3()
        obj.getWorldScale(worldScale)

        // Описание объекта должно быть задано разработчиком при интеграции.
        // Приоритет: obj.userData.description > descriptionResolver > пустая строка.
        const description =
            (obj.userData && typeof obj.userData.description === 'string' && obj.userData.description) ||
            descriptionResolver?.(obj) ||
            ''

        const sceneObj: SceneObject = {
            id: obj.uuid,
            kind,
            name: obj.name || `${kind}-${obj.uuid.slice(0, 6)}`,
            position: vec3(worldPos),
            rotation: euler(rotEuler),
            scale: vec3(worldScale),
            size: objectSize,
            bounds: worldBounds,
            description,
        }

        if (obj instanceof THREE.Mesh) {
            sceneObj.geometry = extractGeometry(obj)
            sceneObj.visual = extractVisual(obj)
        }

        const runeData = (obj.userData as { rune?: { terrain?: TerrainSceneInfo } }).rune
        if (kind === 'terrain' && runeData?.terrain) {
            sceneObj.terrain = runeData.terrain
        }

        if (obj.parent && obj.parent !== scene) {
            sceneObj.relations = {
                parent: obj.parent.uuid,
            }
        }

        // Extract light properties
        if (obj instanceof THREE.DirectionalLight) {
            sceneObj.props = {
                intensity: obj.intensity,
                color: '#' + obj.color.getHexString(),
                castShadow: obj.castShadow,
            }
        } else if (obj instanceof THREE.AmbientLight) {
            sceneObj.props = {
                intensity: obj.intensity,
                color: '#' + obj.color.getHexString(),
            }
        } else if (obj instanceof THREE.PointLight) {
            sceneObj.props = {
                intensity: obj.intensity,
                color: '#' + obj.color.getHexString(),
                distance: obj.distance,
                decay: obj.decay,
            }
        }

        // Extract camera properties
        if (obj instanceof THREE.PerspectiveCamera) {
            sceneObj.props = {
                fov: obj.fov,
                near: obj.near,
                far: obj.far,
                aspect: obj.aspect,
            }
        }

        // Extract grid helper properties
        if (obj instanceof THREE.GridHelper) {
            sceneObj.props = {
                size: (obj as unknown as { size: number }).size,
                divisions: (obj.geometry as THREE.BufferGeometry).attributes.position.count / 2,
            }
        }

        if (kind === 'light') {
            const sub = getLightSubKind(obj)
            if (sub && sub !== 'unknown') sceneObj.lightSubKind = sub
        }

        expandBounds(bounds, sceneObj.bounds.min)
        expandBounds(bounds, sceneObj.bounds.max)

        objects.push(sceneObj)
    })

    const snapshot: SceneSnapshot = {
        timestamp: new Date().toISOString(),
        version: VERSION,
        meta: {
            objectCount: objects.length,
            bounds,
        },
        summary: '',
        objects,
    }

    // Заполняем summary сцены
    snapshot.summary = buildSummary(snapshot)

    return snapshot
}
