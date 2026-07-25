// Pass-3 and pass-4 reference objects. The view-model box is permanent: it is the
// cheapest proof that pass 4 has its own depth buffer and can never be clipped by
// world geometry. The gnomon is a 1 m / 10 m / 100 m scale reference for the near
// scene, off unless ?gnomon=1.

import * as THREE from 'three';

export function createViewModelPlaceholder(): THREE.Object3D {
  const g = new THREE.Group();
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(0.09, 0.06, 0.20),
    new THREE.MeshLambertMaterial({ color: 0xb56a2a }),
  );
  box.position.set(0.42, -0.30, -0.85);
  box.rotation.set(0.1, -0.25, 0.06);
  g.add(box);
  g.add(new THREE.AmbientLight(0xffffff, 1.4));
  const key = new THREE.DirectionalLight(0xffffff, 2.0);
  key.position.set(0.5, 1, 0.8);
  g.add(key);
  g.name = 'viewModelPlaceholder';
  return g;
}

export function createGnomon(): THREE.Object3D {
  const g = new THREE.Group();
  for (const [scale, color] of [[1, 0xff4444], [10, 0x44ff44], [100, 0x4488ff]] as const) {
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(scale, scale, scale),
      new THREE.MeshBasicMaterial({ color, wireframe: true }),
    );
    box.position.set(0, scale * 0.5, -scale * 1.5);
    g.add(box);
  }
  g.name = 'gnomon';
  return g;
}
