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

export const ORB_DETAIL_STOPS = Object.freeze({
  accentStart: 40,
  accentClear: 60,
  expansionStart: 75,
  expansionFull: 90,
  circulationFull: 100,
});

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smoothBand = (value, from, to) => {
  const t = clamp01((value - from) / (to - from));
  return t * t * (3 - 2 * t);
};

// Convert the renderer's stable, presentation-only closeness scale into
// continuous visual weights. These are fades, not mode switches, so zooming
// never makes a resident pop between discrete models.
export function orbDetailAt(closeness = 0) {
  const percent = Number.isFinite(closeness) ? Math.max(0, Math.min(100, closeness)) : 0;
  return {
    percent,
    accents: smoothBand(percent, ORB_DETAIL_STOPS.accentStart, ORB_DETAIL_STOPS.accentClear),
    expansion: smoothBand(percent, ORB_DETAIL_STOPS.expansionStart, ORB_DETAIL_STOPS.expansionFull),
    circulation: smoothBand(percent, ORB_DETAIL_STOPS.expansionFull, ORB_DETAIL_STOPS.circulationFull),
  };
}

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

    // Seven shared meshes keep the resident count from becoming the draw-call
    // count. Only matrices and instance colours change from Orb to Orb.
    const coreGeo = new THREE.IcosahedronGeometry(0.043, 2);
    const mantleGeo = new THREE.IcosahedronGeometry(0.052, 1);
    // The wisps begin against the core, then grow just beyond the mantle as
    // the camera approaches. Their arcs remain lightweight shared geometry.
    const wispGeo = new THREE.TorusGeometry(0.047, 0.0052, 5, 24, Math.PI * 1.42);
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
    const detail = orbDetailAt(camera && camera.userData && camera.userData.zoomCloseness);
    this.lastDetail = detail;
    const frustum = camera && camera.isCamera
      ? _frustum.setFromProjectionMatrix(_projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
      : null;
    _billboard.copy(camera && camera.isCamera ? camera.quaternion : _quaternion.identity());

    // All residents share the camera LOD, so these changes cost only a few
    // material assignments per frame. Identity stays dominant while the core
    // becomes a touch more translucent when the accent layers open out.
    this.core.material.opacity = 0.91 - detail.expansion * 0.055;
    this.mantle.material.opacity = 0.18 + detail.expansion * 0.07;
    this.halo.material.opacity = 0.4 + detail.expansion * 0.06;
    for (const wisp of this.wisps) wisp.material.opacity = 0.14 + detail.accents * 0.4 + detail.circulation * 0.08;

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
      const coreBloom = 1 + detail.expansion * 0.035;
      place(this.core, count, x, centreY, z, _quaternion,
        size * pulse * coreBloom, size * pulse * squash * coreBloom, size * pulse * coreBloom);

      // A slightly offset ellipsoid supplies the walking trail and the slow,
      // decorative vapor circulation. It never feeds position back to Agents.
      const mantleBloom = 1 + detail.expansion * 0.15;
      const mantleDrift = detail.expansion * 0.004 * size;
      const mantleTurn = time * (0.13 + detail.circulation * 0.12) + phase;
      _quaternion.setFromEuler(_euler.set(0, heading + Math.sin(time * 0.3 + phase) * 0.18, mantleTurn));
      place(this.mantle, count,
        x - dx * trail * size + Math.cos(mantleTurn) * mantleDrift,
        centreY + wave * 0.0025 * size,
        z - dz * trail * size + Math.sin(mantleTurn) * mantleDrift,
        _quaternion,
        size * (1.04 + Math.abs(trail) * 5) * mantleBloom,
        size * (0.96 + wave * 0.025) * squash * mantleBloom,
        size * (1.03 + Math.abs(trail) * 9) * mantleBloom);

      // Trait colours remain separate; absent traits get zero-sized instances
      // so the two fixed draw calls work for every crowd size. Present traits
      // also start at zero size below the accent threshold: the far view is a
      // calm identity silhouette, while approach reveals the approved colours.
      for (let k = 0; k < 2; k++) {
        const a = chroma.accents[k], wisp = this.wisps[k];
        if (a) {
          const spinRate = (k ? -0.46 : 0.52) * (0.75 + detail.accents * 0.25 + detail.circulation * 0.65);
          const spin = time * spinRate + phase + k * 2.1;
          const orbit = size * detail.expansion * (0.0055 + detail.circulation * 0.003);
          const wispBloom = detail.accents * (0.88 + detail.expansion * 0.34);
          const ripple = 1 + wave * 0.03 + Math.sin(spin * 1.7) * 0.035 * detail.circulation;
          const wispSize = size * wispBloom * ripple;
          _quaternion.setFromEuler(_euler.set(
            0.72 + 0.38 * Math.sin(spin * 0.7) + detail.circulation * 0.12 * Math.sin(spin),
            spin,
            k ? -0.68 : 0.52));
          place(wisp, count,
            x + Math.cos(spin + k * Math.PI) * orbit,
            centreY + (k ? -0.004 : 0.005) * size
              + Math.sin(spin * 1.35) * size * (0.0015 * detail.accents + 0.0035 * detail.circulation),
            z + Math.sin(spin + k * Math.PI) * orbit,
            _quaternion,
            wispSize, wispSize * squash * (1 + detail.expansion * 0.05), wispSize);
        } else place(wisp, count, x, centreY, z, _quaternion.identity(), 0, 0, 0);
      }

      const haloSize = size * (0.13 + lum.halo * 0.055) * (1 + wave * amount * 0.45)
        * (1 + detail.expansion * 0.12 + detail.circulation * wave * 0.025);
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
