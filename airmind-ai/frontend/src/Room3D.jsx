import { Component, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Clone, Environment, Html, Instance, Instances, Line, OrbitControls, useGLTF } from "@react-three/drei";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { Activity, Cloud, Droplets, Thermometer, Users, Wind } from "lucide-react";
import * as THREE from "three";

const roomSensors = [
  { id: "co2", label: "CO2", position: [-4.9, 2.25, -1.1], icon: Cloud, prominent: true },
  { id: "pm25", label: "PM2.5", position: [-2.2, 1.65, 3.1], icon: Activity, prominent: true },
  { id: "pm10", label: "PM10", position: [0.1, 1.65, 0.2], icon: Activity },
  { id: "tvoc", label: "TVOC", position: [3.25, 2, -1.3], icon: Cloud },
  { id: "co", label: "CO", position: [-4.4, 1.5, 0.9], icon: Cloud },
  { id: "temperature", label: "Temperature", position: [4.5, 2, 0.2], icon: Thermometer, prominent: true },
  { id: "humidity", label: "Humidity", position: [-4.5, 1.6, 2.5], icon: Droplets },
  { id: "occupancy", label: "Occupancy", position: [3, 1.25, 2.9], icon: Users, prominent: true },
  { id: "ventilation_enc", label: "Ventilation", position: [0, 3.48, -3.48], icon: Wind, prominent: true },
  { id: "motion", label: "Motion", position: [4.4, 1.5, 2.1], icon: Activity },
];
const deskPositions = [-3.55, -1.25, 1.15, 3.45].flatMap((x) => [-2.25, 0.1, 2.45].map((z) => [x, 0, z]));
const chairPositions = deskPositions.map(([x, , z]) => [x + 0.38, 0, z + 0.73]);

function Box({ position, size, color, roughness = 0.8, metalness = 0, ...props }) {
  return <mesh position={position} castShadow receiveShadow {...props}>
    <boxGeometry args={size} />
    <meshStandardMaterial color={color} roughness={roughness} metalness={metalness} />
  </mesh>;
}

function WindowBay({ position, rotation = [0, 0, 0], width = 1.45, height = 1.35 }) {
  return <group position={position} rotation={rotation}>
    <mesh position={[0, 0, -0.025]}>
      <planeGeometry args={[width, height]} />
      <meshStandardMaterial color="#306c79" emissive="#12313a" emissiveIntensity={0.6} roughness={0.28} metalness={0.18} />
    </mesh>
    <Box position={[0, height / 2, 0]} size={[width + 0.1, 0.07, 0.1]} color="#9aa9a5" />
    <Box position={[0, -height / 2, 0]} size={[width + 0.1, 0.07, 0.1]} color="#9aa9a5" />
    <Box position={[-width / 2, 0, 0]} size={[0.07, height, 0.1]} color="#9aa9a5" />
    <Box position={[width / 2, 0, 0]} size={[0.07, height, 0.1]} color="#9aa9a5" />
    <Box position={[0, 0, 0.015]} size={[0.035, height, 0.04]} color="#7f999e" />
    <Box position={[0, 0, 0.02]} size={[width, 0.035, 0.04]} color="#7f999e" />
  </group>;
}

function RoomShell() {
  return <group>
    <Box position={[0, -0.13, 0]} size={[11.4, 0.26, 8.25]} color="#59666a" roughness={0.92} />
    <Box position={[0, 2, -4.08]} size={[11.4, 4.05, 0.18]} color="#182a35" />
    <Box position={[-5.62, 1.95, 0]} size={[0.18, 4.05, 8.25]} color="#27383f" />
    <Box position={[5.62, 1.95, -2.95]} size={[0.18, 4.05, 2.35]} color="#27383f" />
    <Box position={[5.62, 1.95, 3.15]} size={[0.18, 4.05, 1.85]} color="#27383f" />
    <Box position={[5.62, 3.76, 0.25]} size={[0.18, 0.42, 2.35]} color="#27383f" />
    {[-2.7, -0.7, 1.3, 3.25].map((z) => <WindowBay key={z} position={[-5.5, 2.55, z]} rotation={[0, Math.PI / 2, 0]} width={1.7} height={2.15} />)}
    {[-2.35, -0.45, 1.45, 3.35].map((z) => <WindowBay key={z} position={[5.48, 2.55, z]} rotation={[0, Math.PI / 2, 0]} width={1.55} height={1.55} />)}
    <Box position={[0, 2.05, -3.94]} size={[3.6, 1.55, 0.08]} color="#101d20" />
    <Box position={[0, 2.05, -3.885]} size={[3.46, 1.42, 0.02]} color="#10241f" />
    <Box position={[5.48, 1.65, 0.22]} size={[0.08, 3.2, 1.5]} color="#583e32" />
    <Box position={[5.4, 1.65, 0.22]} size={[0.06, 3.2, 1.5]} color="#795643" />
    <Box position={[0, 3.56, -3.66]} size={[1.2, 0.16, 0.62]} color="#89979a" metalness={0.38} />
    <Box position={[0, 3.45, -3.66]} size={[1.02, 0.08, 0.48]} color="#344b55" metalness={0.25} />
    {[-0.37, -0.12, 0.12, 0.37].map((x) => <Box key={x} position={[x, 3.64, -3.66]} size={[0.1, 0.025, 0.4]} color="#43d9d0" metalness={0.4} />)}
    {[-4.6, 4.6].map((x) => <group key={x} position={[x, 0, 3.7]}>
      <mesh position={[0, 0.62, 0]}><boxGeometry args={[0.035, 1.24, 0.035]} /><meshStandardMaterial color="#809aa3" metalness={0.72} roughness={0.24} /></mesh>
      <mesh position={[0, 0.62, -0.1]}><boxGeometry args={[0.035, 1.15, 0.035]} /><meshStandardMaterial color="#8ab5bf" transparent opacity={0.22} roughness={0.12} metalness={0.12} /></mesh>
    </group>)}
    <mesh position={[0, 0.9, 3.7]}><boxGeometry args={[9.2, 0.035, 0.035]} /><meshStandardMaterial color="#8cabb4" metalness={0.68} roughness={0.25} /></mesh>
  </group>;
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
  return <group>
    {parts.map((part, partIndex) => <Instances key={`${url}-${partIndex}`} geometry={part.geometry} material={part.material} limit={positions.length}>
      {positions.map((position, index) => <Instance key={index} position={position} rotation={[0, rotations?.[index] || 0, 0]} scale={scale} />)}
    </Instances>)}
  </group>;
}

function Furniture() {
  const { scene: bookcase } = useGLTF("/models/bookcaseOpen.glb");
  const { scene: plant } = useGLTF("/models/pottedPlant.glb");
  const { scene: wallLamp } = useGLTF("/models/lampWall.glb");
  return <group>
    <ModelInstances url="/models/desk.glb" positions={deskPositions} scale={1.72} rotations={deskPositions.map(() => Math.PI)} />
    <ModelInstances url="/models/chair.glb" positions={chairPositions} scale={1.65} rotations={chairPositions.map(() => 0)} />
    <Clone object={bookcase} position={[-4.9, 0, -2.95]} rotation={[0, Math.PI / 2, 0]} scale={1.7} />
    <Clone object={bookcase} position={[4.95, 0, -2.8]} rotation={[0, -Math.PI / 2, 0]} scale={1.4} />
    {[[-4.75, 0, 3.35], [4.55, 0, 3.25], [4.65, 0, -3.45]].map((position, index) => <Clone key={index} object={plant} position={position} scale={1.5} />)}
    {[-2.65, 1.65].map((z) => <Clone key={z} object={wallLamp} position={[-5.32, 2.75, z]} rotation={[0, Math.PI / 2, 0]} scale={1.35} />)}
    <Clone object={bookcase} position={[0, 0, -3.42]} rotation={[0, Math.PI, 0]} scale={1.15} />
  </group>;
}

function Airflow({ active, reducedMotion }) {
  const lines = useRef([]);
  const curves = useMemo(() => [-0.32, 0, 0.32].map((shift) => new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 3.43, -3.38),
    new THREE.Vector3(shift * 0.5, 2.95, -2.65),
    new THREE.Vector3(shift, 2.35, -1.1),
    new THREE.Vector3(shift * 1.5 + 0.4, 1.85, 0.7),
    new THREE.Vector3(shift * 1.8 + 0.8, 1.25, 2.55),
  ]).getPoints(32)), []);
  useFrame(({ clock }) => {
    if (!active || reducedMotion) return;
    const offset = -clock.getElapsedTime() * 0.22;
    lines.current.forEach((line) => {
      if (line?.material) line.material.dashOffset = offset;
    });
  });
  return <group>{curves.map((points, index) => <Line key={index} ref={(node) => { lines.current[index] = node; }}
    points={points} color="#2ee6d6" lineWidth={1.6} dashed dashSize={0.16} gapSize={0.11}
    transparent opacity={active ? 0.68 : 0.36} />)}</group>;
}

function SensorNode({ sensor, selected, value, label, status, onSelect, reducedMotion }) {
  const node = useRef();
  const Icon = sensor.icon;
  const dotTone = status?.excess >= 0.65 ? "critical" : status?.excess > 0 ? "elevated" : "normal";
  useFrame(({ clock }) => {
    if (node.current && selected && !reducedMotion) node.current.scale.setScalar(1 + Math.sin(clock.getElapsedTime() * 2) * 0.08);
  });
  return <group position={sensor.position}>
    <mesh ref={node} onClick={(event) => { event.stopPropagation(); onSelect(sensor.id); }} onPointerOver={(event) => { event.stopPropagation(); document.body.style.cursor = "pointer"; }} onPointerOut={() => { document.body.style.cursor = "default"; }}>
      <sphereGeometry args={[selected ? 0.17 : 0.14, 16, 12]} />
      <meshStandardMaterial color={selected ? "#b8fff7" : "#43d9d0"} emissive={selected ? "#43d9d0" : "#147e7c"} emissiveIntensity={selected ? 1.2 : 0.55} roughness={0.25} />
    </mesh>
    {(selected || sensor.prominent) && <Html distanceFactor={11} position={[0, 0.3, 0]} center occlude>
      <button type="button" className={`room-marker-label${selected ? " selected" : ""}`} onClick={(event) => { event.stopPropagation(); onSelect(sensor.id); }}>
        <span className="marker-icon"><Icon size={14} /></span><span className="marker-copy"><b>{label}</b><span>{value}</span></span><i className={`marker-status ${dotTone}`} />
      </button>
    </Html>}
  </group>;
}

function PollutantParticles({ sensorValues, reducedMotion }) {
  const instance = useRef();
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const particles = useMemo(() => {
    const elevated = Object.entries(sensorValues).filter(([, sensor]) => sensor.excess > 0);
    const total = elevated.reduce((sum, [, sensor]) => sum + Math.ceil(sensor.excess * 30), 0);
    const max = Math.min(150, total);
    return Array.from({ length: max }, (_, index) => {
      let cursor = index;
      let sensor = elevated[0]?.[1];
      for (const [, candidate] of elevated) {
        const amount = Math.ceil(candidate.excess * 30);
        if (cursor < amount) { sensor = candidate; break; }
        cursor -= amount;
      }
      const base = sensor?.position || [0, 1, 0];
      const angle = index * 2.399963;
      const radius = 0.16 + (index % 7) * 0.055;
      return { base, angle, radius, phase: index * 0.37, excess: sensor?.excess || 0 };
    });
  }, [sensorValues]);

  useFrame(({ clock }) => {
    if (!instance.current) return;
    const time = reducedMotion ? 0 : clock.getElapsedTime();
    particles.forEach((particle, index) => {
      const { base, angle, radius, phase, excess } = particle;
      dummy.position.set(base[0] + Math.cos(angle) * radius, base[1] + ((time * 0.12 + phase) % 0.9), base[2] + Math.sin(angle) * radius);
      const size = 0.018 + excess * 0.025;
      dummy.scale.setScalar(size);
      dummy.updateMatrix();
      instance.current.setMatrixAt(index, dummy.matrix);
      instance.current.setColorAt(index, new THREE.Color(excess > 0.68 ? "#ff6b5b" : "#ffb347"));
    });
    instance.current.count = particles.length;
    instance.current.instanceMatrix.needsUpdate = true;
    if (instance.current.instanceColor) instance.current.instanceColor.needsUpdate = true;
  });

  if (!particles.length) return null;
  return <instancedMesh ref={instance} args={[undefined, undefined, Math.min(150, particles.length)]} frustumCulled={false}>
    <sphereGeometry args={[1, 6, 5]} /><meshBasicMaterial vertexColors transparent opacity={0.78} depthWrite={false} />
  </instancedMesh>;
}

function CameraFocus({ selectedId, resetSignal, controlsRef }) {
  const { camera } = useThree();
  const target = useRef(new THREE.Vector3(0, 1.1, -0.3));
  const destination = useRef(new THREE.Vector3(9.4, 7.2, 10.2));
  const previousSelection = useRef(selectedId);
  const previousReset = useRef(resetSignal);
  const moving = useRef(false);

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    if (!controls) return;
    if (selectedId !== previousSelection.current) {
      previousSelection.current = selectedId;
      const sensor = roomSensors.find((item) => item.id === selectedId);
      if (sensor) {
        const offset = camera.position.clone().sub(controls.target).setLength(7.5);
        target.current.set(...sensor.position);
        destination.current.copy(target.current).add(offset);
        moving.current = true;
        controls.enabled = false;
      }
    }
    if (resetSignal !== previousReset.current) {
      previousReset.current = resetSignal;
      target.current.set(0, 1.1, -0.3);
      destination.current.set(9.4, 7.2, 10.2);
      moving.current = true;
      controls.enabled = false;
    }
    if (!moving.current) return;
    const alpha = 1 - Math.exp(-delta * 3.4);
    controls.target.lerp(target.current, alpha);
    camera.position.lerp(destination.current, alpha);
    camera.lookAt(controls.target);
    controls.update();
    if (camera.position.distanceTo(destination.current) < 0.035 && controls.target.distanceTo(target.current) < 0.035) {
      camera.position.copy(destination.current);
      controls.target.copy(target.current);
      controls.enabled = true;
      moving.current = false;
    }
  });
  return null;
}

function RoomScene({ selectedId, sensorValues, onSelect, ventilationOpen, reducedMotion, controlsRef, resetSignal, autoRotate, onInteraction }) {
  return <>
    <color attach="background" args={["#050c16"]} />
    <fog attach="fog" args={["#050c16", 19, 38]} />
    <hemisphereLight intensity={0.42} color="#2d8892" groundColor="#07101a" />
    <ambientLight intensity={0.32} color="#9ac4ca" />
    <directionalLight position={[-8, 7, 2]} intensity={1.35} color="#8edce0" />
    <spotLight position={[-3.2, 4.8, -0.8]} target-position={[-3, 0, -0.5]} intensity={36} angle={0.55} penumbra={0.8} distance={12} color="#ffb066" castShadow />
    <spotLight position={[2, 4.7, 1.5]} target-position={[2, 0, 1.4]} intensity={30} angle={0.52} penumbra={0.8} distance={11} color="#ffb066" />
    <pointLight position={[0, 3.15, -3.2]} intensity={24} distance={9} color="#ffc184" />
    <Environment preset="night" environmentIntensity={0.16} background={false} />
    <RoomShell />
    <Furniture />
    <ContactShadows position={[0, 0.015, 0]} opacity={0.24} scale={12} blur={2.4} far={3} resolution={256} />
    <Airflow active={Boolean(ventilationOpen)} reducedMotion={reducedMotion} />
    <PollutantParticles sensorValues={sensorValues} reducedMotion={reducedMotion} />
    {roomSensors.map((sensor) => <SensorNode key={sensor.id} sensor={sensor} selected={selectedId === sensor.id}
      value={sensorValues[sensor.id]?.display ?? "--"} label={sensor.label} status={sensorValues[sensor.id]}
      onSelect={onSelect} reducedMotion={reducedMotion} />)}
    <CameraFocus selectedId={selectedId} resetSignal={resetSignal} controlsRef={controlsRef} />
    <OrbitControls ref={controlsRef} makeDefault enableDamping dampingFactor={0.08} minDistance={7} maxDistance={18}
      minPolarAngle={0.42} maxPolarAngle={Math.PI / 2.03} target={[0, 1.1, -0.3]} screenSpacePanning
      autoRotate={autoRotate} autoRotateSpeed={0.22} onStart={onInteraction} />
    <EffectComposer multisampling={0}><Bloom intensity={0.18} luminanceThreshold={0.82} mipmapBlur /><Vignette eskil={false} offset={0.22} darkness={0.54} /></EffectComposer>
  </>;
}

class RoomErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error) {
    this.props.onError?.(error);
  }
  render() {
    if (this.state.failed) return this.props.fallback;
    return this.props.children;
  }
}

export function RoomFallback({ message = "Interactive 3D is unavailable in this browser." }) {
  return <div className="room-fallback"><div className="fallback-room"><div className="fallback-back-wall" /><div className="fallback-window" /><div className="fallback-floor" /><div className="fallback-desk desk-one" /><div className="fallback-desk desk-two" /><div className="fallback-desk desk-three" /><div className="fallback-airflow" /></div><div><strong>Room visualization unavailable</strong><p>{message} Sensor readings and recommendations are still available alongside the scene.</p></div></div>;
}

export default function Room3D({ selectedId, sensorValues, onSelect, ventilationOpen, reducedMotion, controlsRef, panMode, onReady, onError, resetSignal, autoRotate, onInteraction }) {
  const fallback = <RoomFallback />;
  return <RoomErrorBoundary fallback={fallback} onError={onError}>
    <Canvas shadows dpr={[1, 1.45]} camera={{ position: [10, 7, 10], fov: 43 }} gl={{ antialias: true, powerPreference: "low-power", alpha: false }} fallback={fallback} onCreated={onReady}>
      <RoomScene selectedId={selectedId} sensorValues={sensorValues} onSelect={onSelect}
        ventilationOpen={ventilationOpen} reducedMotion={reducedMotion} controlsRef={controlsRef} panMode={panMode}
        resetSignal={resetSignal} autoRotate={autoRotate} onInteraction={onInteraction} />
    </Canvas>
  </RoomErrorBoundary>;
}