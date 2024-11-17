// @ts-nocheck // TODO: Remove

import * as THREE from "three";
import { BackgroundObjects, DotObjects, LineObjects, SceneObjects, ShaderData } from "./types";
import Line from "./components";


const getShaders = (): ShaderData => {
    const vertexShader = `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;
  
    const fragmentShader = `
      varying vec2 vUv;
      uniform vec3 colorA;
      uniform vec3 colorB;
      uniform vec2 center;
      void main() {
        float dist = distance(vUv, center);
        float t = smoothstep(0.0, 0.7, dist);
        gl_FragColor = vec4(mix(colorA, colorB, t), 1.0);
      }
    `;
  
    const uniforms = {
      colorA: { value: new THREE.Color(30 / 255, 50 / 255, 90 / 255) },
      colorB: { value: new THREE.Color(15 / 255, 21 / 255, 37 / 255) },
      center: { value: new THREE.Vector2(0.5, 0.3) },
    };
  
    return { vertexShader, fragmentShader, uniforms };
  };
  
  export const initializeScene = (mountRef: React.RefObject<HTMLDivElement>): SceneObjects => {
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  
    const setSize = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
  
    setSize();
    renderer.setClearColor(0x000000, 0);
    mountRef.current?.appendChild(renderer.domElement);
    camera.position.z = 1;
  
    return { scene, camera, renderer };
  };
  
  export const createBackground = (scene: THREE.Scene): BackgroundObjects => {
    const { vertexShader, fragmentShader, uniforms } = getShaders();
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
    });
    const plane = new THREE.PlaneGeometry(2, 2);
    const backgroundMesh = new THREE.Mesh(plane, material);
    scene.add(backgroundMesh);
    return { plane, material, backgroundMesh };
  };
  
  export const createDots = (scene: THREE.Scene, numDots: number): DotObjects => {
    const dotsGroup = new THREE.Group();
    const dotGeometry = new THREE.SphereGeometry(0.005, 32, 32);
    const dotColors = [
      new THREE.Color(0x3366cc),
      new THREE.Color(0x1a3366),
      new THREE.Color(0xffffff),
    ];
  
    const dots: THREE.Mesh[] = [];
  
    for (let i = 0; i < numDots; i++) {
      const dotMaterial = new THREE.MeshPhongMaterial({
        color: dotColors[i % dotColors.length],
        emissive: dotColors[i % dotColors.length],
        specular: 0x111111,
        shininess: 30,
        transparent: true,
        opacity: 0.7,
      });
  
      const dot = new THREE.Mesh(dotGeometry, dotMaterial);
      dot.position.set(
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
        Math.random() * 0.5 - 0.25
      );
      (dot as any).velocity = new THREE.Vector3(
        Math.random() * 0.0005 - 0.00025,
        Math.random() * 0.0005 - 0.00025,
        Math.random() * 0.0002 - 0.0001
      );
      dots.push(dot);
      dotsGroup.add(dot);
    }
  
    scene.add(dotsGroup);
    return { dotGeometry, dots, dotsGroup };
  };
  
  export const createLines = (scene: THREE.Scene): LineObjects => {
    const linesGroup = new THREE.Group();
    const lineGeometry = new THREE.BufferGeometry();
    const lineMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
    });
    const linesObject = new THREE.LineSegments(lineGeometry, lineMaterial);
    linesGroup.add(linesObject);
    scene.add(linesGroup);
    return { lineGeometry, lineMaterial, linesObject, linesGroup };
  };
  
  const updateDots = (dots: THREE.Mesh[]): void => {
    dots.forEach((dot) => {
      const velocity = (dot as any).velocity;
      dot.position.add(velocity);
      if (Math.abs(dot.position.x) > 1) velocity.x *= -1;
      if (Math.abs(dot.position.y) > 1) velocity.y *= -1;
      if (Math.abs(dot.position.z) > 0.25) velocity.z *= -1;
    });
  };
  
  export const updateLines = (lines: Line[], dots: THREE.Mesh[], lineGeometry: THREE.BufferGeometry): void => {
    // Update existing lines and remove dead ones
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].update()) {
        lines.splice(i, 1);
      }
    }
  
    // Add new lines
    dots.forEach((dot, i) => {
      const nearestDots = dots
        .map((otherDot, index) => ({
          dot: otherDot,
          distance: dot.position.distanceTo(otherDot.position),
          index,
        }))
        .filter(({ index }) => index !== i)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 3);
  
      nearestDots.forEach(({ dot: nearDot }) => {
        addLine(lines, dot, nearDot);
      });
    });
  
    // Update line geometry
    const linePositions: number[] = [];
    const lineColors: number[] = [];
  
    lines.forEach((line) => {
      linePositions.push(...line.getPositions());
      lineColors.push(...line.getColors());
    });
  
    lineGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(linePositions, 3)
    );
    lineGeometry.setAttribute(
      "color",
      new THREE.Float32BufferAttribute(lineColors, 4)
    );
  };
  
  export const addLine = (lines: Line[], startDot: THREE.Mesh, endDot: THREE.Mesh): void => {
    const existingLine = lines.find(
      (line) =>
        (line.startDot === startDot && line.endDot === endDot) ||
        (line.startDot === endDot && line.endDot === startDot)
    );
    if (!existingLine) {
      lines.push(new Line(startDot, endDot));
    }
  };
  
  export const animate = (
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    dots: THREE.Mesh[],
    lines: Line[],
    lineGeometry: THREE.BufferGeometry
  ): number => {
    const animationFrameId = requestAnimationFrame(() =>
      animate(renderer, scene, camera, dots, lines, lineGeometry)
    );
  
    updateDots(dots);
    updateLines(lines, dots, lineGeometry);
  
    renderer.render(scene, camera);
  
    return animationFrameId;
  };