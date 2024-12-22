// @ts-nocheck // TODO: Remove
import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';

class Line {
  constructor(startDot, endDot) {
    this.startDot = startDot;
    this.endDot = endDot;
    this.life = 1;
    this.maxDistance = 0.25;
  }

  update() {
    const distance = this.startDot.position.distanceTo(this.endDot.position);
    if (distance > this.maxDistance) {
      this.life -= 0.05;
    } else {
      this.life = Math.min(1, this.life + 0.05);
    }
    return this.life > 0;
  }

  getPositions() {
    return [
      this.startDot.position.x, this.startDot.position.y, this.startDot.position.z,
      this.endDot.position.x, this.endDot.position.y, this.endDot.position.z
    ];
  }

  getColors() {
    const alpha = this.life * (1 - this.startDot.position.distanceTo(this.endDot.position) / this.maxDistance);
    return [1, 1, 1, alpha, 1, 1, 1, alpha];
  }
}

const ThreeBackground = () => {
  const mountRef = useRef(null);

  useEffect(() => {
    let width = window.innerWidth;
    let height = window.innerHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });

    const setSize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    setSize();
    renderer.setClearColor(0x000000, 0); // Transparent background
    mountRef.current.appendChild(renderer.domElement);

    // Create subtle inverted radial gradient background with off-center origin
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
        // Adjust the 0.7 value to control the size of the gradient
        float t = smoothstep(0.0, 0.7, dist);
        gl_FragColor = vec4(mix(colorA, colorB, t), 1.0);
      }
    `;

    const uniforms = {
      colorA: { value: new THREE.Color(18/255, 18/255, 24/255) },  // Inner color (darker)
      colorB: { value: new THREE.Color(8/255, 8/255, 12/255) },    // Outer color (even darker)
      center: { value: new THREE.Vector2(0.6, 0.4) }  // Adjusted center point
    };

    const material = new THREE.ShaderMaterial({
      uniforms: uniforms,
      vertexShader: vertexShader,
      fragmentShader: fragmentShader,
    });

    const plane = new THREE.PlaneGeometry(2, 2);
    const backgroundMesh = new THREE.Mesh(plane, material);
    scene.add(backgroundMesh);

    // Create modern, 3D dots with multiple colors
    const dotsGroup = new THREE.Group();
    const linesGroup = new THREE.Group();
    scene.add(dotsGroup);
    scene.add(linesGroup);

    const dotColors = [
      new THREE.Color(0x6366f1),  // Indigo
      new THREE.Color(0x8b5cf6),  // Purple
      new THREE.Color(0xc084fc),  // Light purple
    ];

    const numDots = 60;
    const dots = [];
    const lines = [];

    const light = new THREE.PointLight(0xffffff, 1, 100);
    light.position.set(0, 0, 10);
    scene.add(light);

    for (let i = 0; i < numDots; i++) {
      const dotMaterial = new THREE.MeshPhongMaterial({
        color: dotColors[i % dotColors.length],
        emissive: dotColors[i % dotColors.length],
        specular: 0x222222,
        shininess: 20,
        transparent: true,
        opacity: 0.5
      });

      const dotGeometry = new THREE.SphereGeometry(0.004, 32, 32);
      const dot = new THREE.Mesh(dotGeometry, dotMaterial);
      dot.position.set(
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
        Math.random() * 0.5 - 0.25
      );
      dot.velocity = new THREE.Vector3(
        Math.random() * 0.0005 - 0.00025,
        Math.random() * 0.0005 - 0.00025,
        Math.random() * 0.0002 - 0.0001
      );
      dots.push(dot);
      dotsGroup.add(dot);
    }

    const addLine = (startDot, endDot) => {
      const existingLine = lines.find(line => 
        (line.startDot === startDot && line.endDot === endDot) ||
        (line.startDot === endDot && line.endDot === startDot)
      );
      if (!existingLine) {
        lines.push(new Line(startDot, endDot));
      }
    };

    camera.position.z = 1;

    const lineGeometry = new THREE.BufferGeometry();
    const lineMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
    });
    const linesObject = new THREE.LineSegments(lineGeometry, lineMaterial);
    linesGroup.add(linesObject);

    const animate = () => {
      requestAnimationFrame(animate);

      // Update dot positions
      dots.forEach(dot => {
        dot.position.add(dot.velocity);

        if (Math.abs(dot.position.x) > 1) dot.velocity.x *= -1;
        if (Math.abs(dot.position.y) > 1) dot.velocity.y *= -1;
        if (Math.abs(dot.position.z) > 0.25) dot.velocity.z *= -1;
      });

      // Update existing lines and remove dead ones
      for (let i = lines.length - 1; i >= 0; i--) {
        if (!lines[i].update()) {
          lines.splice(i, 1);
        }
      }

      // Add new lines
      dots.forEach((dot, i) => {
        const nearestDots = dots
          .map((otherDot, index) => ({ dot: otherDot, distance: dot.position.distanceTo(otherDot.position), index }))
          .filter(({ index }) => index !== i)
          .sort((a, b) => a.distance - b.distance)
          .slice(0, 3);

        nearestDots.forEach(({ dot: nearDot }) => {
          addLine(dot, nearDot);
        });
      });

      // Update line geometry
      const linePositions = [];
      const lineColors = [];

      lines.forEach(line => {
        linePositions.push(...line.getPositions());
        lineColors.push(...line.getColors());
      });

      lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
      lineGeometry.setAttribute('color', new THREE.Float32BufferAttribute(lineColors, 4));

      renderer.render(scene, camera);
    };

    animate();

    const handleResize = () => {
      setSize();
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      mountRef.current.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div 
      ref={mountRef} 
      style={{ 
        position: 'fixed', 
        top: 0, 
        left: 0, 
        width: '100%', 
        height: '100%', 
        zIndex: -1,
        overflow: 'hidden'
      }} 
    />
  );
};

export default ThreeBackground;