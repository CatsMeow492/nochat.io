// @ts-nocheck
import React from 'react'
import * as THREE from "three";

class Line {
    constructor(startDot, endDot) {
      this.startDot = startDot;
      this.endDot = endDot;
      this.life = 1;
      this.maxDistance = 0.3;
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
        this.startDot.position.x,
        this.startDot.position.y,
        this.startDot.position.z,
        this.endDot.position.x,
        this.endDot.position.y,
        this.endDot.position.z,
      ];
    }
  
    getColors() {
      const alpha =
        this.life *
        (1 -
          this.startDot.position.distanceTo(this.endDot.position) /
            this.maxDistance);
      return [1, 1, 1, alpha, 1, 1, 1, alpha];
    }
  }

  export default Line;