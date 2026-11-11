// Instanced Living Window Orbs. This is deliberately a view of the walkers
// Agents already chose to show: it never creates residents, paths or activity.

import * as THREE from 'three';
import { chromaticOf } from './chromatic.js';

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _billboard = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _white = new THREE.Color('#fffaf0');
const _projection = new THREE.Matrix4();
const _frustum = new THREE.Frustum();
const _bounds = new THREE.Sphere(new THREE.Vector3(), 0.22);
const TAU = Math.PI * 2;

function softTexture(size = 32) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x + 0.5) / size * 2 - 1, dy = (y + 0.5) / size * 2 - 1;
    const d = Math.min(1, Math.hypot(dx, dy));
    // A wide, painterly falloff: visible centre, very soft outer edge.
    const a = Math.pow(1 - d, 2.25) * (0.82 + 0.18 * Math.cos(d * Math.PI));
    const i = (y * size + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 255;
    data[i + 3] = Math.round(a * 255);
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function instanced(scene, geometry, material, max, order) {
  const mesh = new THREE.InstancedMesh(geometry, material, max);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.renderOrder = order;
  scene.add(mesh);
  return mesh;
}

function place(mesh, index, x, y, z, quaternion, sx, sy = sx, sz = sx) {
  _position.set(x, y, z);
  _scale.set(sx, sy, sz);
  _matrix.compose(_position, quaternion, _scale);
  mesh.setMatrixAt(index, _matrix);
}

function update(mesh, count, colorsDirty = false) {
  mesh.count = count;
  mesh.visible = count > 0;
  mesh.instanceMatrix.needsUpdate = true;
  if (colorsDirty && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

// Names are descriptive only; all of these states already exist on walkers.
export function orbActivityOf(wk) {
  if (!wk) return 'stationary';
  if (wk.mode === 'ride') return 'riding';
  if (wk.sit && !wk.moving) return 'sitting';
  if (wk.working && !wk.moving) return 'working';
  if (wk.mode === 'wait') return 'waiting';
  if (wk.moving) return 'walking';
  return 'stationary';
}

export class OrbView {
  constructor(scene, max) {
    this.scene = scene;
    this.max = max;
    this.texture = softTexture();
    this.visuals = new WeakMap();
    this.fallbackVisual = this._makeVisual(null);
    this.colorOwners = new Array(max);

    // Five shared meshes keep the resident count from becoming the draw-call
    // count. Only matrices and instance colours change from Orb to Orb.
    const coreGeo = new THREE.IcosahedronGeometry(0.043, 2);
    const mantleGeo = new THREE.IcosahedronGeometry(0.052, 1);
    const wispGeo = new THREE.TorusGeometry(0.034, 0.0047, 4, 18, Math.PI * 1.42);
    const haloGeo = new THREE.PlaneGeometry(1, 1);
    const shadowGeo = new THREE.CircleGeometry(0.04, 16).rotateX(-Math.PI / 2);

    // setColorAt supplies USE_INSTANCING_COLOR automatically. Do not enable
    // material.vertexColors: these geometries have no per-vertex color
    // attribute, and multiplying by that missing attribute renders black.
    this.halo = instanced(scene, haloGeo, new THREE.MeshBasicMaterial({
      map: this.texture, color: '#ffffff', transparent: true,
      opacity: 0.44, depthTest: true, depthWrite: false, toneMapped: false,
    }), max, 3);
    this.core = instanced(scene, coreGeo, new THREE.MeshStandardMaterial({
      color: '#ffffff', roughness: 0.58, metalness: 0,
      transparent: true, opacity: 0.9, depthTest: true, depthWrite: true,
    }), max, 4);
    this.mantle = instanced(scene, mantleGeo, new THREE.MeshBasicMaterial({
      color: '#ffffff', transparent: true, opacity: 0.2,
      depthTest: true, depthWrite: false, toneMapped: false,
    }), max, 5);
    const wispMat = () => new THREE.MeshBasicMaterial({
      color: '#ffffff', transparent: true, opacity: 0.62,
      depthTest: true, depthWrite: false, toneMapped: false,
    });
    this.wisps = [
      instanced(scene, wispGeo, wispMat(), max, 6),
      instanced(scene, wispGeo.clone(), wispMat(), max, 6),
    ];
    this.shadow = instanced(scene, shadowGeo, new THREE.MeshBasicMaterial({
      color: '#172126', transparent: true, opacity: 0.24, depthWrite: false,
    }), max, 1);

    // As with the legacy renderer, a cheap invisible body is the sole sun
    // shadow caster. The translucent visual layers do not each cast a shadow.
    this.caster = instanced(scene, new THREE.SphereGeometry(0.044, 8, 6), new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0, colorWrite: false, depthWrite: false,
    }), max, 0);
    this.caster.castShadow = true;
    this.caster.receiveShadow = false;

    this.meshes = [this.halo, this.core, this.mantle, ...this.wisps, this.shadow, this.caster];
  }

  _makeVisual(r) {
    const chroma = chromaticOf(r), lum = chroma.luminosity;
    return {
      chroma,
      core: new THREE.Color(chroma.identity.hex).multiplyScalar(0.72 + lum.intensity * 0.36),
      mantle: new THREE.Color(chroma.identity.hex).lerp(_white, 0.08 + lum.intensity * 0.06),
      halo: new THREE.Color(chroma.identity.hex).lerp(_white, 0.18),
      accents: chroma.accents.map(a => new THREE.Color(a.hex)),
      look: r && r.look, id: r && r.id, age: r && r.age, mood: r && r.mood,
      traits: r && r._traits, traitAge: r && r._traitAge,
    };
  }

  _visual(r) {
    if (!r || (typeof r !== 'object' && typeof r !== 'function')) return this.fallbackVisual;
    let v = this.visuals.get(r);
    if (!v || !Object.is(v.look, r.look) || v.id !== r.id || v.age !== r.age || !Object.is(v.mood, r.mood) || v.traits !== r._traits || v.traitAge !== r._traitAge) {
      v = this._makeVisual(r);
      this.visuals.set(r, v);
    }
    return v;
  }

  // Same handoff as VillagerView: live visible walkers, environment, camera.
  draw(walkers, env = {}, camera = null) {
    const time = (typeof performance !== 'undefined' ? performance.now() : Date.now()) * 0.001;
    const frustum = camera && camera.isCamera
      ? _frustum.setFromProjectionMatrix(_projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
      : null;
    _billboard.copy(camera && camera.isCamera ? camera.quaternion : _quaternion.identity());

    let count = 0;
    let colorsDirty = false;
    for (const wk of walkers || []) {
      if (count >= this.max) break;
      if (!wk || wk.delay > 0) continue;
      const x = Number.isFinite(wk.x) ? wk.x : 0, y = Number.isFinite(wk.y) ? wk.y : 0, z = Number.isFinite(wk.z) ? wk.z : 0;
      if (frustum) {
        _bounds.center.set(x, y + 0.07, z);
        if (!frustum.intersectsSphere(_bounds)) { wk.lx = null; continue; }
      }

      const visual = this._visual(wk.r), chroma = visual.chroma, lum = chroma.luminosity;
      const size = Number.isFinite(wk.lk && wk.lk.scale) ? wk.lk.scale : 1;
      const activity = orbActivityOf(wk), phase = chroma.phase;
      let rate = 0.72, amount = 0.025, squash = 1, trail = 0;
      if (activity === 'walking') { rate = 3.15; amount = 0.045; trail = 0.012; }
      else if (activity === 'working') { rate = 2.55; amount = 0.075; }
      else if (activity === 'waiting') { rate = 1.15; amount = 0.05; }
      else if (activity === 'sitting') { rate = 0.62; amount = 0.018; squash = 0.82; }
      else if (activity === 'riding') { rate = 0.82; amount = 0.022; }
      const wave = Math.sin(time * rate + phase);
      const pulse = 1 + wave * amount;
      const centreY = y + 0.068 * size * (activity === 'sitting' ? 0.78 : 1);
      const heading = Number.isFinite(wk.heading) ? wk.heading : 0;
      const dx = Math.sin(heading), dz = Math.cos(heading);

      // Walker order is stable for the usual frame. Re-upload colors only
      // when a different resident occupies this instance slot or its mood /
      // traits changed; animated matrices still update every frame.
      if (this.colorOwners[count] !== visual) {
        this.colorOwners[count] = visual;
        this.core.setColorAt(count, visual.core);
        this.mantle.setColorAt(count, visual.mantle);
        this.halo.setColorAt(count, visual.halo);
        for (let k = 0; k < 2; k++) this.wisps[k].setColorAt(count, visual.accents[k] || visual.core);
        colorsDirty = true;
      }
      _quaternion.setFromEuler(_euler.set(0, time * 0.18 + phase, wave * 0.05));
      place(this.core, count, x, centreY, z, _quaternion, size * pulse, size * pulse * squash, size * pulse);

      // A slightly offset ellipsoid supplies the walking trail and the slow,
      // decorative vapor circulation. It never feeds position back to Agents.
      _quaternion.setFromEuler(_euler.set(0, heading + Math.sin(time * 0.3 + phase) * 0.18, time * 0.13 + phase));
      place(this.mantle, count, x - dx * trail * size, centreY + wave * 0.0025 * size, z - dz * trail * size,
        _quaternion, size * (1.04 + Math.abs(trail) * 5), size * (0.96 + wave * 0.025) * squash, size * (1.03 + Math.abs(trail) * 9));

      // Trait colours remain separate; absent traits get zero-sized instances
      // so the two fixed draw calls work for every crowd size.
      for (let k = 0; k < 2; k++) {
        const a = chroma.accents[k], wisp = this.wisps[k];
        if (a) {
          const spin = time * (k ? -0.46 : 0.52) + phase + k * 2.1;
          _quaternion.setFromEuler(_euler.set(0.72 + 0.38 * Math.sin(spin * 0.7), spin, k ? -0.68 : 0.52));
          place(wisp, count, x, centreY + (k ? -0.004 : 0.005) * size, z, _quaternion,
            size * (1 + wave * 0.035), size * squash, size * (1 + wave * 0.035));
        } else place(wisp, count, x, centreY, z, _quaternion.identity(), 0, 0, 0);
      }

      const haloSize = size * (0.13 + lum.halo * 0.055) * (1 + wave * amount * 0.45);
      place(this.halo, count, x, centreY, z, _billboard, haloSize, haloSize, haloSize);

      place(this.shadow, count, x, y + 0.004, z, _quaternion.identity(), size * (0.8 + pulse * 0.2), size, size * (0.8 + pulse * 0.2));
      place(this.caster, count, x, centreY, z, _quaternion.identity(), size, size * squash, size);

      // Keep night lanterns at an Orb's edge. Lighting remains owned by Game.
      if (wk.lamp) {
        wk.lx = x + Math.cos(heading) * 0.05 * size;
        wk.ly = centreY - 0.018 * size;
        wk.lz = z - Math.sin(heading) * 0.05 * size;
      } else wk.lx = wk.ly = wk.lz = null;
      wk._i = count;
      count++;
    }

    for (const mesh of [this.halo, this.core, this.mantle, ...this.wisps]) update(mesh, count, colorsDirty);
    update(this.shadow, count);
    update(this.caster, count);
  }

  dispose() {
    if (!this.scene) return;
    for (const mesh of this.meshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
      if (mesh.dispose) mesh.dispose();
    }
    this.texture.dispose();
    this.meshes.length = 0;
    this.visuals = null;
    this.fallbackVisual = null;
    this.colorOwners = null;
    this.scene = null;
  }
}
