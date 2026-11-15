import { Matrix4, Ray, Sphere, Vector2, Vector3, type Intersection, type Mesh, type Raycaster } from 'three';

const inv = new Matrix4();
const ray = new Ray();
const unit = new Sphere(new Vector3(), 1);
const hit = new Vector3();

/**
 * Exact ray / unit-sphere hit test with the same UVs as three's SphereGeometry.
 * Replaces the per-triangle mesh raycast (tens of thousands of triangles on every pointer move).
 * Use as `<mesh raycast={sphereRaycast}>`; `this` is the mesh.
 */
export function sphereRaycast(this: Mesh, raycaster: Raycaster, intersects: Intersection[]) {
  inv.copy(this.matrixWorld).invert();
  ray.copy(raycaster.ray).applyMatrix4(inv);
  if (!ray.intersectSphere(unit, hit)) return;
  const local = hit.clone();
  const point = hit.clone().applyMatrix4(this.matrixWorld);
  const distance = raycaster.ray.origin.distanceTo(point);
  if (distance < raycaster.near || distance > raycaster.far) return;
  // SphereGeometry: x = -cos(phi) sin(theta), y = cos(theta), z = sin(phi) sin(theta); u = phi / 2pi, v = 1 - theta / pi.
  const theta = Math.acos(Math.max(-1, Math.min(1, local.y)));
  let phi = Math.atan2(local.z, -local.x);
  if (phi < 0) phi += Math.PI * 2;
  intersects.push({
    distance,
    point,
    object: this,
    uv: new Vector2(phi / (Math.PI * 2), 1 - theta / Math.PI),
  } as Intersection);
}
