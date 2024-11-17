import * as THREE from "three";
export interface ShaderData {
    vertexShader: string;
    fragmentShader: string;
    uniforms: { [uniform: string]: THREE.IUniform };
  }
  
  export interface SceneObjects {
    scene: THREE.Scene;
    camera: THREE.OrthographicCamera;
    renderer: THREE.WebGLRenderer;
  }
  
  export interface BackgroundObjects {
    plane: THREE.PlaneGeometry;
    material: THREE.ShaderMaterial;
    backgroundMesh: THREE.Mesh;
  }
  
  export interface DotObjects {
    dotGeometry: THREE.SphereGeometry;
    dots: THREE.Mesh[];
    dotsGroup: THREE.Group;
  }
  
  export interface LineObjects {
    lineGeometry: THREE.BufferGeometry;
    lineMaterial: THREE.LineBasicMaterial;
    linesObject: THREE.LineSegments;
    linesGroup: THREE.Group;
  }
  
  