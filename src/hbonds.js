// Dotted hydrogen-bond lines (like the dotted lines in the textbook figures), drawn as instanced dots.
import * as THREE from 'three';

const DOTS = 5;
const geo = new THREE.SphereGeometry(1, 8, 6);
const GOOD = new THREE.Color(0xfff27a), BAD = new THREE.Color(0xff4d4d), _c = new THREE.Color();

export class HBondViz {
  constructor(max = 64) {
    this.max = max;
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ toneMapped: false }), max * DOTS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * DOTS * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.n = 0;
    this._m = new THREE.Matrix4(); this._p = new THREE.Vector3(); this._q = new THREE.Quaternion();
  }
  begin() { this.n = 0; }
  /** a, b in metres; quality 0..1; fade 0..1 */
  add(a, b, quality, fade, time) {
    if (this.n >= this.max) return;
    for (let k = 0; k < DOTS; k++) {
      const t = (k + 0.5 + Math.sin(time * 3 + this.n) * 0.12) / DOTS;
      this._p.lerpVectors(a, b, t);
      const r = 0.0052 * fade * (0.75 + 0.5 * quality);
      this._m.compose(this._p, this._q, new THREE.Vector3(r, r, r));
      const i = this.n * DOTS + k;
      this.mesh.setMatrixAt(i, this._m);
      this.mesh.setColorAt(i, _c.copy(BAD).lerp(GOOD, quality));
    }
    this.n++;
  }
  end() {
    this.mesh.count = this.n * DOTS;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
