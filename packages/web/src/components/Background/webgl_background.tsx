
// @ts-nocheck // TODO: Remove
import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { animate, createBackground, createDots, createLines, initializeScene } from '../../services/threejs/dot-effect';
import Line from '../../services/threejs/dot-effect/components';

/**
 * This effect is responsible for:
 * 1. Initializes the Three.js scene, camera and renderer.
 * 2. Creating and positioning the background, dots and lines.
 * 3. Setting up the animation loop for continuous rendering
 * 4. Resize events
 * 5. Cleaning up resources
 *
 * This effect MUST clean up the resources before the component unmounts
 * or the react renderer will not clean up the DOM before navigating
 */

const ThreeBackground: React.FC = () => {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const { scene, camera, renderer } = initializeScene(mountRef);
    const { plane, material, backgroundMesh } = createBackground(scene);
    const { dotGeometry, dots, dotsGroup } = createDots(scene, 80);
    const { lineGeometry, lineMaterial, linesObject, linesGroup } = createLines(scene);

    // Add light
    const light = new THREE.PointLight(0xffffff, 1, 100);
    light.position.set(0, 0, 10);
    scene.add(light);

    // Start animation
    const lines: Line[] = [];
    const animationFrameId = animate(renderer, scene, camera, dots, lines, lineGeometry);

    // Handle window resize
    const handleResize = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    window.addEventListener('resize', handleResize);

    // Cleanup function
    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);

      // Dispose of geometries
      dotGeometry.dispose();
      plane.dispose();
      lineGeometry.dispose();

      // Dispose of materials
      material.dispose();
      lineMaterial.dispose();
      dots.forEach((dot) => (dot.material as THREE.Material).dispose());

      // Remove meshes from scene
      scene.remove(backgroundMesh);
      scene.remove(dotsGroup);
      scene.remove(linesGroup);

      // Dispose of renderer
      renderer.dispose();

      // Remove canvas from DOM
      if (mountRef.current) {
        mountRef.current.removeChild(renderer.domElement);
      }
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
        overflow: 'hidden',
      }}
    />
  );
};

export default ThreeBackground;
