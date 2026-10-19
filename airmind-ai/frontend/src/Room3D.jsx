import { Component, useMemo, useRef, useState, useEffect } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  Clone,
  ContactShadows,
  Environment,
  Html,
  Instance,
  Instances,
  Line,
  OrbitControls,
  useGLTF,
} from "@react-three/drei";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import {
  Activity,
  Cloud,
  Droplets,
  RotateCcw,
  RotateCw,
  Search,
  Move,
  Thermometer,
  Users,
  Wind,
  Sliders,
  Sparkles,
} from "lucide-react";
import * as THREE from "three";

// Preload GLB models to eliminate stutter
useGLTF.preload("/models/desk.glb");
useGLTF.preload("/models/chair.glb");
useGLTF.preload("/models/bookcaseOpen.glb");
useGLTF.preload("/models/pottedPlant.glb");
useGLTF.preload("/models/lampWall.glb");

// Illustrative sensor coordinates within cutaway classroom
export const ROOM_SENSORS = [
  { id: "ventilation_enc", name: "Ventilation", label: "Ventilation", position: [0, 3.48, -3.48], icon: Sliders },
  { id: "co2", name: "CO2", label: "CO2", position: [-4.85, 2.25, -1.1], icon: Wind },
  { id: "temperature", name: "Temperature", label: "Temperature", position: [4.45, 1.95, 0.2], icon: Thermometer },
  { id: "pm25", name: "PM2.5", label: "PM2.5", position: [-2.2, 1.6, 2.9], icon: Sparkles },
  { id: "occupancy", name: "Occupancy", label: "Occupancy", position: [2.9, 1.25, 2.7], icon: Users },
];

// 4x3 student desk positions: 4 in X, 3 in Z = 12 desks
const deskPositions = [-3.6, -1.2, 1.2, 3.6].flatMap((x) =>
  [-2.2, 0.2, 2.6].map((z) => [x, 0, z])
);
const chairPositions = deskPositions.map(([x, , z]) => [x + 0.38, 0, z + 0.72]);

function Box({ position, size, color, roughness = 0.8, metalness = 0, ...props }) {
  return (
    <mesh position={position} castShadow receiveShadow {...props}>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={roughness} metalness={metalness} />
    </mesh>
  );
}

function WindowBay({ position, rotation = [0, 0, 0], width = 1.45, height = 2.15 }) {
  return (
    <group position={position} rotation={rotation}>
      {/* Glass Pane */}
      <mesh position={[0, 0, -0.02]}>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial
          color="#2e7685"
          emissive="#123842"
          emissiveIntensity={0.65}
          roughness={0.15}
          metalness={0.2}
          transparent
          opacity={0.7}
        />
      </mesh>
      {/* Window Frame Beams */}
      <Box position={[0, height / 2, 0]} size={[width + 0.1, 0.08, 0.1]} color="#7a9096" />
      <Box position={[0, -height / 2, 0]} size={[width + 0.1, 0.08, 0.1]} color="#7a9096" />
      <Box position={[-width / 2, 0, 0]} size={[0.08, height, 0.1]} color="#7a9096" />
      <Box position={[width / 2, 0, 0]} size={[0.08, height, 0.1]} color="#7a9096" />
      <Box position={[0, 0, 0.015]} size={[0.035, height, 0.04]} color="#566e74" />
      <Box position={[0, 0, 0.02]} size={[width, 0.035, 0.04]} color="#566e74" />
    </group>
  );
}

function RoomShell() {
  return (
    <group>
      {/* Floor */}
      <Box position={[0, -0.13, 0]} size={[11.6, 0.26, 8.4]} color="#1b2e3a" roughness={0.75} />
      {/* Floor tile line accents */}
      <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[11.5, 8.3]} />
        <meshStandardMaterial color="#142632" roughness={0.8} />
      </mesh>

      {/* Back Wall */}
      <Box position={[0, 2.05, -4.12]} size={[11.6, 4.15, 0.18]} color="#0c1d28" />

      {/* Left Wall with Windows */}
      <Box position={[-5.72, 2.05, 0]} size={[0.18, 4.15, 8.4]} color="#152732" />

      {/* Right Wall cutaway with Door frame */}
      <Box position={[5.72, 2.05, -2.95]} size={[0.18, 4.15, 2.45]} color="#152732" />
      <Box position={[5.72, 2.05, 3.15]} size={[0.18, 4.15, 2.05]} color="#152732" />
      <Box position={[5.72, 3.82, 0.25]} size={[0.18, 0.6, 2.45]} color="#152732" />

      {/* Door */}
      <Box position={[5.6, 1.7, 0.25]} size={[0.08, 3.3, 1.55]} color="#3d271e" />
      <Box position={[5.52, 1.7, 0.25]} size={[0.06, 3.2, 1.45]} color="#5e3e30" />
      {/* Door Handle */}
      <mesh position={[5.45, 1.65, 0.8]}>
        <sphereGeometry args={[0.045, 12, 12]} />
        <meshStandardMaterial color="#ffb347" metalness={0.8} roughness={0.2} />
      </mesh>

      {/* Green Outdoor Backdrop behind left windows */}
      <mesh position={[-6.2, 2.2, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[12, 5.5]} />
        <meshStandardMaterial color="#0f3427" roughness={0.9} />
      </mesh>
      {/* Secondary lush foliage plane */}
      <mesh position={[-6.1, 1.8, -0.5]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[9, 4]} />
        <meshStandardMaterial color="#1a4c3a" roughness={0.85} />
      </mesh>

      {/* Tall Window Bays on Left Wall */}
      {[-2.8, -0.9, 1.0, 2.9].map((z) => (
        <WindowBay
          key={z}
          position={[-5.62, 2.35, z]}
          rotation={[0, Math.PI / 2, 0]}
          width={1.65}
          height={2.4}
        />
      ))}

      {/* Blackboard on Back Wall */}
      <Box position={[0, 2.1, -3.98]} size={[3.8, 1.65, 0.08]} color="#06181f" />
      <Box position={[0, 2.1, -3.92]} size={[3.65, 1.5, 0.02]} color="#0c251e" roughness={0.9} />

      {/* Ceiling AC / Ventilation Unit */}
      <Box position={[0, 3.65, -3.65]} size={[1.35, 0.22, 0.7]} color="#8ca1a8" metalness={0.4} />
      <Box position={[0, 3.52, -3.65]} size={[1.15, 0.09, 0.52]} color="#23353e" metalness={0.3} />
      {/* AC Front Vent Grille louvers */}
      {[-0.42, -0.14, 0.14, 0.42].map((x) => (
        <Box key={x} position={[x, 3.52, -3.38]} size={[0.18, 0.02, 0.02]} color="#2ee6d6" metalness={0.6} />
      ))}
    </group>
  );
}

function ModelInstances({ url, positions, scale = 1, rotations }) {
  const { scene } = useGLTF(url);
  const parts = useMemo(() => {
    scene.updateMatrixWorld(true);
    const meshes = [];
    scene.traverse((object) => {
      if (!object.isMesh) return;
      const geometry = object.geometry.clone();
      geometry.applyMatrix4(object.matrixWorld);
      meshes.push({ geometry, material: object.material });
    });
    return meshes;
  }, [scene]);

  return (
    <group>
      {parts.map((part, partIndex) => (
        <Instances
          key={`${url}-${partIndex}`}
          geometry={part.geometry}
          material={part.material}
          limit={positions.length}
        >
          {positions.map((position, index) => (
            <Instance
              key={index}
              position={position}
              rotation={[0, rotations?.[index] || 0, 0]}
              scale={scale}
            />
          ))}
        </Instances>
      ))}
    </group>
  );
}

function Furniture() {
  const { scene: bookcase } = useGLTF("/models/bookcaseOpen.glb");
  const { scene: plant } = useGLTF("/models/pottedPlant.glb");
  const { scene: wallLamp } = useGLTF("/models/lampWall.glb");

  return (
    <group>
      {/* 4x3 Student Desks & Chairs */}
      <ModelInstances
        url="/models/desk.glb"
        positions={deskPositions}
        scale={1.68}
        rotations={deskPositions.map(() => Math.PI)}
      />
      <ModelInstances
        url="/models/chair.glb"
        positions={chairPositions}
        scale={1.62}
        rotations={chairPositions.map(() => 0)}
      />

      {/* Teacher Desk at front-right of room */}
      <ModelInstances
        url="/models/desk.glb"
        positions={[[0, 0, -3.3]]}
        scale={1.9}
        rotations={[Math.PI]}
      />
      <ModelInstances
        url="/models/chair.glb"
        positions={[[0.4, 0, -2.6]]}
        scale={1.8}
        rotations={[0]}
      />

      {/* Bookshelves */}
      <Clone object={bookcase} position={[-5.05, 0, -2.95]} rotation={[0, Math.PI / 2, 0]} scale={1.65} />
      <Clone object={bookcase} position={[5.05, 0, -2.75]} rotation={[0, -Math.PI / 2, 0]} scale={1.4} />

      {/* Corner Plants */}
      {[
        [-4.9, 0, 3.4],
        [4.8, 0, 3.3],
        [-4.9, 0, -0.6],
        [4.8, 0, -3.5],
      ].map((pos, idx) => (
        <Clone key={idx} object={plant} position={pos} scale={1.55} />
      ))}

      {/* Warm Wall Sconces */}
      {[-2.8, 1.2].map((z) => (
        <Clone
          key={z}
          object={wallLamp}
          position={[-5.45, 2.8, z]}
          rotation={[0, Math.PI / 2, 0]}
          scale={1.3}
        />
      ))}
      <Clone
        object={wallLamp}
        position={[5.45, 2.8, -1.8]}
        rotation={[0, -Math.PI / 2, 0]}
        scale={1.3}
      />
    </group>
  );
}

// Animated cyan dashed airflow streams from the AC unit
function Airflow({ active, reducedMotion }) {
  const lines = useRef([]);
  const curves = useMemo(
    () =>
      [-0.45, -0.15, 0.15, 0.45].map(
        (shift) =>
          new THREE.CatmullRomCurve3([
            new THREE.Vector3(shift * 0.4, 3.5, -3.4),
            new THREE.Vector3(shift * 0.9, 3.0, -2.6),
            new THREE.Vector3(shift * 1.5, 2.3, -1.0),
            new THREE.Vector3(shift * 1.9 - 0.2, 1.7, 0.8),
            new THREE.Vector3(shift * 2.3 - 0.5, 1.2, 2.6),
          ]).getPoints(36)
      ),
    []
  );

  useFrame(({ clock }) => {
    if (!active || reducedMotion) return;
    const offset = -clock.getElapsedTime() * 0.28;
    lines.current.forEach((line) => {
      if (line?.material) line.material.dashOffset = offset;
    });
  });

  return (
    <group>
      {curves.map((points, index) => (
        <Line
          key={index}
          ref={(node) => {
            lines.current[index] = node;
          }}
          points={points}
          color="#2ee6d6"
          lineWidth={2}
          dashed
          dashSize={0.2}
          gapSize={0.14}
          transparent
          opacity={active ? 0.8 : 0.45}
        />
      ))}
    </group>
  );
}

// Amber particles (max 150) near elevated sensors, ONLY when a threshold is exceeded
function PollutantParticles({ sensorStatuses, reducedMotion }) {
  const instance = useRef();
  const dummy = useMemo(() => new THREE.Object3D(), []);

  // Find elevated sensors
  const particles = useMemo(() => {
    const elevated = Object.entries(sensorStatuses).filter(
      ([, s]) => s.isElevated && s.position
    );
    if (!elevated.length) return [];

    const max = 120;
    return Array.from({ length: max }, (_, index) => {
      const sensorIndex = index % elevated.length;
      const [, sensor] = elevated[sensorIndex];
      const base = sensor.position;
      const angle = index * 2.399963;
      const radius = 0.25 + (index % 5) * 0.08;
      return {
        base,
        angle,
        radius,
        phase: index * 0.35,
        isUrgent: sensor.isUrgent,
      };
    });
  }, [sensorStatuses]);

  useFrame(({ clock }) => {
    if (!instance.current || !particles.length) return;
    const time = reducedMotion ? 0 : clock.getElapsedTime();
    particles.forEach((particle, index) => {
      const { base, angle, radius, phase, isUrgent } = particle;
      dummy.position.set(
        base[0] + Math.cos(angle) * radius,
        base[1] + ((time * 0.15 + phase) % 0.85) - 0.2,
        base[2] + Math.sin(angle) * radius
      );
      dummy.scale.setScalar(0.024 + (index % 3) * 0.008);
      dummy.updateMatrix();
      instance.current.setMatrixAt(index, dummy.matrix);
      instance.current.setColorAt(
        index,
        new THREE.Color(isUrgent ? "#ff6b5b" : "#ffb347")
      );
    });
    instance.current.count = particles.length;
    instance.current.instanceMatrix.needsUpdate = true;
    if (instance.current.instanceColor)
      instance.current.instanceColor.needsUpdate = true;
  });

  if (!particles.length) return null;

  return (
    <instancedMesh
      ref={instance}
      args={[undefined, undefined, particles.length]}
      frustumCulled={false}
    >
      <sphereGeometry args={[1, 6, 6]} />
      <meshBasicMaterial vertexColors transparent opacity={0.8} depthWrite={false} />
    </instancedMesh>
  );
}

// 3D HTML sensor marker card with glowing active state and selection click
function SensorMarker({ sensor, selected, displayValue, statusInfo, onSelect, reducedMotion }) {
  const Icon = sensor.icon;
  const dotColorClass = statusInfo?.dotClass || "cyan";

  return (
    <group position={sensor.position}>
      {/* Interactive anchor point */}
      <mesh
        onClick={(e) => {
          e.stopPropagation();
          onSelect(sensor.id);
        }}
        onPointerOver={() => {
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          document.body.style.cursor = "default";
        }}
      >
        <sphereGeometry args={[selected ? 0.16 : 0.12, 16, 12]} />
        <meshStandardMaterial
          color={selected ? "#2ee6d6" : "#1a666e"}
          emissive="#2ee6d6"
          emissiveIntensity={selected ? 1.4 : 0.4}
          roughness={0.3}
        />
      </mesh>

      {/* Dark Glass Sensor Badge Card */}
      <Html distanceFactor={11} position={[0, 0.32, 0]} center>
        <button
          type="button"
          className={`three-marker-card ${selected ? "selected-glow" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(sensor.id);
          }}
          aria-label={`Select ${sensor.label}`}
        >
          <div className="three-marker-icon">
            <Icon size={14} />
          </div>
          <div className="three-marker-details">
            <span className="three-marker-name">{sensor.name}</span>
            <span className="three-marker-val">{displayValue}</span>
          </div>
          <span className={`three-marker-dot ${dotColorClass}`} />
        </button>
      </Html>
    </group>
  );
}

// Smooth camera lerp toward selected sensor or reset default position
function CameraRig({ selectedId, resetSignal, controlsRef, reducedMotion }) {
  const { camera } = useThree();
  const defaultTarget = useMemo(() => new THREE.Vector3(0, 1.1, -0.4), []);
  const defaultPos = useMemo(() => new THREE.Vector3(8.8, 11.2, 8.8), []);

  const target = useRef(defaultTarget.clone());
  const destination = useRef(defaultPos.clone());
  const previousSelection = useRef(selectedId);
  const previousReset = useRef(resetSignal);
  const isTransitioning = useRef(false);

  useEffect(() => {
    if (selectedId !== previousSelection.current) {
      previousSelection.current = selectedId;
      const sensor = ROOM_SENSORS.find((s) => s.id === selectedId);
      if (sensor) {
        target.current.set(...sensor.position);
        // Position camera slightly offset from the sensor position
        destination.current.set(
          sensor.position[0] + 4.2,
          sensor.position[1] + 3.8,
          sensor.position[2] + 4.2
        );
        isTransitioning.current = true;
      }
    }
  }, [selectedId]);

  useEffect(() => {
    if (resetSignal !== previousReset.current) {
      previousReset.current = resetSignal;
      target.current.copy(defaultTarget);
      destination.current.copy(defaultPos);
      isTransitioning.current = true;
    }
  }, [resetSignal, defaultTarget, defaultPos]);

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    if (!controls || !isTransitioning.current) return;

    if (reducedMotion) {
      controls.target.copy(target.current);
      camera.position.copy(destination.current);
      controls.update();
      isTransitioning.current = false;
      return;
    }

    const step = 1 - Math.exp(-delta * 3.6);
    controls.target.lerp(target.current, step);
    camera.position.lerp(destination.current, step);
    controls.update();

    if (
      camera.position.distanceTo(destination.current) < 0.04 &&
      controls.target.distanceTo(target.current) < 0.04
    ) {
      camera.position.copy(destination.current);
      controls.target.copy(target.current);
      controls.update();
      isTransitioning.current = false;
    }
  });

  return null;
}

function ClassroomScene({
  selectedId,
  sensorStatuses,
  onSelect,
  ventilationOpen,
  reducedMotion,
  controlsRef,
  resetSignal,
  autoRotate,
  onInteraction,
}) {
  return (
    <>
      <color attach="background" args={["#050c16"]} />
      <fog attach="fog" args={["#050c16", 18, 36]} />

      {/* Dim teal hemisphere light */}
      <hemisphereLight intensity={0.42} color="#2ee6d6" groundColor="#050c16" />
      <ambientLight intensity={0.28} color="#8ec5cf" />

      {/* Cool window directional light from left */}
      <directionalLight position={[-8.5, 6.5, 0]} intensity={1.45} color="#8edce0" />

      {/* Warm spot lights (#ffb066) over desks */}
      <spotLight
        position={[-2.2, 5.8, -0.6]}
        target-position={[-2.2, 0, -0.6]}
        intensity={36}
        angle={0.56}
        penumbra={0.8}
        color="#ffb066"
        castShadow
      />
      <spotLight
        position={[2.2, 5.8, 1.4]}
        target-position={[2.2, 0, 1.4]}
        intensity={32}
        angle={0.54}
        penumbra={0.8}
        color="#ffb066"
      />

      {/* Warm ambient wall lamp light */}
      <pointLight position={[0, 3.2, -3.2]} intensity={22} distance={8} color="#ffb066" />

      {/* Low-intensity night Environment */}
      <Environment preset="night" environmentIntensity={0.16} background={false} />

      {/* Room Shell Architecture */}
      <RoomShell />

      {/* Classroom Furniture */}
      <Furniture />

      {/* Soft Contact Shadows */}
      <ContactShadows
        position={[0, 0.015, 0]}
        opacity={0.3}
        scale={14}
        blur={2.4}
        far={3}
        resolution={256}
      />

      {/* Airflow streaks from AC */}
      <Airflow active={Boolean(ventilationOpen)} reducedMotion={reducedMotion} />

      {/* Amber particles when threshold is exceeded */}
      <PollutantParticles sensorStatuses={sensorStatuses} reducedMotion={reducedMotion} />

      {/* Sensor label cards */}
      {ROOM_SENSORS.map((s) => (
        <SensorMarker
          key={s.id}
          sensor={s}
          selected={selectedId === s.id}
          displayValue={sensorStatuses[s.id]?.display ?? "--"}
          statusInfo={sensorStatuses[s.id]}
          onSelect={onSelect}
          reducedMotion={reducedMotion}
        />
      ))}

      {/* Smooth camera lerp */}
      <CameraRig
        selectedId={selectedId}
        resetSignal={resetSignal}
        controlsRef={controlsRef}
        reducedMotion={reducedMotion}
      />

      {/* OrbitControls */}
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={6}
        maxDistance={18}
        minPolarAngle={0.35}
        maxPolarAngle={Math.PI / 2.05}
        target={[0, 1.1, -0.4]}
        screenSpacePanning
        autoRotate={autoRotate}
        autoRotateSpeed={0.35}
        onStart={onInteraction}
      />

      {/* Low Bloom and Vignette Post-processing */}
      <EffectComposer multisampling={0}>
        <Bloom intensity={0.18} luminanceThreshold={0.82} mipmapBlur />
        <Vignette eskil={false} offset={0.22} darkness={0.54} />
      </EffectComposer>
    </>
  );
}

// Error boundary for 3D room
class RoomErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error) {
    this.props.onError?.(error);
  }
  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

// WebGL Fallback: flat list of sensor cards so the rest of app keeps working
export function WebGLFallback({ sensors, sensorStatuses, selectedId, onSelect }) {
  return (
    <div className="webgl-fallback-container">
      <div className="fallback-header">
        <strong>3D Room Viewport Unavailable</strong>
        <p>Interactive WebGL is disabled or unsupported. Sensor telemetry remains fully active below:</p>
      </div>
      <div className="fallback-sensor-grid">
        {sensors.map((s) => {
          const status = sensorStatuses[s.id];
          const Icon = s.icon;
          return (
            <button
              key={s.id}
              type="button"
              className={`fallback-sensor-card ${selectedId === s.id ? "active" : ""}`}
              onClick={() => onSelect(s.id)}
            >
              <div className="fallback-card-icon">
                <Icon size={18} />
              </div>
              <div className="fallback-card-info">
                <span className="fallback-card-title">{s.name}</span>
                <span className="fallback-card-val">{status?.display || "--"}</span>
              </div>
              <span className={`fallback-card-dot ${status?.dotClass || "cyan"}`} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function Room3D({
  selectedId,
  sensorStatuses,
  onSelect,
  ventilationOpen,
  reducedMotion,
  controlsRef,
  resetSignal,
  autoRotate,
  onInteraction,
  onReady,
  onError,
}) {
  const fallback = (
    <WebGLFallback
      sensors={ROOM_SENSORS}
      sensorStatuses={sensorStatuses}
      selectedId={selectedId}
      onSelect={onSelect}
    />
  );

  return (
    <RoomErrorBoundary fallback={fallback} onError={onError}>
      <Canvas
        shadows
        dpr={[1, 1.5]}
        camera={{ position: [8.8, 11.2, 8.8], fov: 30 }}
        gl={{ antialias: true, powerPreference: "default", alpha: true }}
        onCreated={onReady}
      >
        <ClassroomScene
          selectedId={selectedId}
          sensorStatuses={sensorStatuses}
          onSelect={onSelect}
          ventilationOpen={ventilationOpen}
          reducedMotion={reducedMotion}
          controlsRef={controlsRef}
          resetSignal={resetSignal}
          autoRotate={autoRotate}
          onInteraction={onInteraction}
        />
      </Canvas>
    </RoomErrorBoundary>
  );
}