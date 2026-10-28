// Neon "computer world": hex / checker floor, gradient sky, drifting particles, stage ring.
import * as THREE from 'three';

const floorVert = /* glsl */`
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const floorFrag = /* glsl */`
  precision highp float;
  varying vec3 vWorld;
  uniform float uTime;
  uniform float uMode;      // 0 hex, 1 checker
  uniform vec3 uCyan;
  uniform vec3 uMagenta;
  uniform vec3 uBase;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float hexDist(vec2 p){ p = abs(p); return max(dot(p, normalize(vec2(1.0, 1.7320508))), p.x); }
  vec4 hexCoords(vec2 uv){
    vec2 r = vec2(1.0, 1.7320508); vec2 h = r * 0.5;
    vec2 a = mod(uv, r) - h; vec2 b = mod(uv - h, r) - h;
    vec2 gv = dot(a, a) < dot(b, b) ? a : b;
    return vec4(gv, uv - gv);
  }

  void main() {
    vec2 p = vWorld.xz;
    float r = length(p);
    float fade = 1.0 - smoothstep(6.0, 26.0, r);
    vec3 col = uBase;
    float glow = 0.0;
    vec3 line = uCyan;

    if (uMode < 0.5) {
      vec4 hc = hexCoords(p * 1.25);
      float e = 0.5 - hexDist(hc.xy);            // 0 at the edge
      float edge = 1.0 - smoothstep(0.0, 0.045, e);
      float halo = 1.0 - smoothstep(0.0, 0.22, e);
      float id = hash(hc.zw);
      float pulse = 0.5 + 0.5 * sin(uTime * 1.4 + id * 6.283);
      float ring = smoothstep(0.9, 1.0, sin(r * 1.3 - uTime * 1.6));
      float cellGlow = step(0.93, id) * pulse;     // a few cells light up
      line = mix(uCyan, uMagenta, step(0.82, id) * 0.8 + ring * 0.3);
      glow = edge * (0.75 + 0.6 * ring) + halo * 0.12;
      col += uMagenta * cellGlow * 0.22 * (1.0 - edge) * 0.8;
    } else {
      vec2 g = p * 0.9;
      vec2 cell = floor(g);
      float chk = mod(cell.x + cell.y, 2.0);
      vec2 f = abs(fract(g) - 0.5);
      float e = 0.5 - max(f.x, f.y);
      float edge = 1.0 - smoothstep(0.0, 0.03, e);
      float halo = 1.0 - smoothstep(0.0, 0.18, e);
      float ring = smoothstep(0.9, 1.0, sin(r * 1.3 - uTime * 1.6));
      col += mix(vec3(0.0), vec3(0.03, 0.04, 0.10), chk);
      line = mix(uCyan, uMagenta, ring * 0.6 + step(0.5, hash(cell)) * 0.25);
      glow = edge * (0.7 + 0.6 * ring) + halo * 0.10;
    }
    vec3 outc = col + line * glow;
    outc *= fade;
    gl_FragColor = vec4(outc, 1.0);
  }`;

const skyFrag = /* glsl */`
  precision highp float;
  varying vec3 vDir;
  uniform float uTime;
  float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  void main(){
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 top = vec3(0.012, 0.014, 0.05);
    vec3 hor = vec3(0.22, 0.04, 0.30);
    vec3 col = mix(hor, top, smoothstep(0.0, 0.55, h));
    col += vec3(0.0, 0.35, 0.45) * pow(1.0 - abs(h), 14.0) * 0.5; // thin cyan horizon line
    // stars
    vec3 q = floor(d * 160.0);
    float s = step(0.9965, hash(q)) * smoothstep(0.02, 0.4, h);
    col += vec3(0.7, 0.85, 1.0) * s * (0.6 + 0.4 * sin(uTime * 2.0 + hash(q) * 20.0));
    gl_FragColor = vec4(col, 1.0);
  }`;

export function createEnvironment(scene) {
  const root = new THREE.Group();
  scene.add(root);

  // floor
  const floorMat = new THREE.ShaderMaterial({
    vertexShader: floorVert, fragmentShader: floorFrag,
    uniforms: {
      uTime: { value: 0 }, uMode: { value: 0 },
      uCyan: { value: new THREE.Color(0x19d9ff) }, uMagenta: { value: new THREE.Color(0xff2fe0) },
      uBase: { value: new THREE.Color(0x03040e) },
    },
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2), floorMat);
  root.add(floor);

  // sky dome
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; }',
    fragmentShader: skyFrag,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(40, 32, 16), skyMat);
  sky.renderOrder = -10;
  root.add(sky);

  // particles
  const N = 260;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), seeds = new Float32Array(N);
  const c = new THREE.Color();
  for (let i = 0; i < N; i++) {
    const a = Math.random() * Math.PI * 2, r = 1.5 + Math.random() * 9;
    pos.set([Math.cos(a) * r, Math.random() * 5, Math.sin(a) * r], i * 3);
    c.set(Math.random() < 0.6 ? 0x19d9ff : 0xff2fe0); col.set([c.r, c.g, c.b], i * 3);
    seeds[i] = Math.random() * 100;
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  pg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const particles = new THREE.Points(pg, new THREE.PointsMaterial({
    size: 0.035, vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
  }));
  root.add(particles);

  // stage ring (kept in passthrough as a soft "play area" marker)
  const stage = new THREE.Group();
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x19d9ff, transparent: true, opacity: 0.9, toneMapped: false });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.0, 0.012, 8, 128).rotateX(Math.PI / 2), ringMat);
  ring.position.y = 0.01;
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(2.18, 0.006, 8, 128).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff2fe0, transparent: true, opacity: 0.8, toneMapped: false }));
  ring2.position.y = 0.01;
  stage.add(ring, ring2);
  root.add(stage);

  let mode = 'desktop';
  function setMode(m) {
    mode = m;
    const mr = m === 'passthrough';
    floor.visible = !mr; sky.visible = !mr; particles.visible = !mr;
    ringMat.opacity = mr ? 0.35 : 0.9;
    ring2.material.opacity = mr ? 0.25 : 0.8;
  }
  function setFloor(style) { floorMat.uniforms.uMode.value = style === 'checker' ? 1 : 0; }
  function update(t) {
    floorMat.uniforms.uTime.value = t; skyMat.uniforms.uTime.value = t;
    const p = pg.attributes.position;
    for (let i = 0; i < N; i++) {
      const y = p.getY(i) + 0.0025 + Math.sin(t * 0.6 + seeds[i]) * 0.0008;
      p.setY(i, y > 5 ? 0 : y);
    }
    p.needsUpdate = true;
  }
  return { root, setMode, setFloor, update, get mode() { return mode; } };
}
