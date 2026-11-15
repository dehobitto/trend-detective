import { Vector3 } from 'three';

/**
 * Shared uniforms for the globe shaders. The sun is fixed relative to the viewer (CameraRig updates it
 * every frame), so the face you look at is always in daylight with a soft terminator on one edge.
 * The cloud shift drifts the cloud layer and its shadows on the ground together.
 */
export const globeUniforms = {
  uSun: { value: new Vector3(0, 0, 1) },
  uCloudShift: { value: 0 },
};
