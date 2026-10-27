// Rotating a held object. Inputs, usable together:
//  * spin / tilt: thumbstick or keys/right-drag (rotate about the vertical / horizontal play-area axes)
//  * 6DOF "handle": while `ptr.squeeze` is held (controller grip, or middle-finger pinch with hands) the object
//    follows the orientation of the pointer (controller or hand). `always` makes this the default (used for
//    the tutorial molecule, which doesn't move, so turning your hand just turns it like a turntable).
// Returns true while the 6DOF handle is active, so callers can freeze the object's position.
import * as THREE from 'three';

const AX_Y = new THREE.Vector3(0, 1, 0), AX_X = new THREE.Vector3(1, 0, 0);
const _a = new THREE.Quaternion(), _b = new THREE.Quaternion();

export function applyRotation(ptr, q, worldQuat, always = false) {
  if (ptr.spin) q.premultiply(_a.setFromAxisAngle(AX_Y, ptr.spin));
  if (ptr.tilt) q.premultiply(_a.setFromAxisAngle(AX_X, ptr.tilt));
  // Hands have no grip button and the aiming ray swings as the hand moves, so they follow the WRIST
  // orientation instead: the piece turns with the hand all the time, and still moves at the same time.
  const hand = ptr.isHand && ptr.handQuat;
  const src = hand || ptr.quat;
  const follow = hand ? true : (ptr.squeeze || always);
  if (!src || !follow) { ptr._rot = null; return false; }
  const pq = _b.copy(worldQuat).invert().multiply(src);   // orientation in the play-area frame
  if (!ptr._rot) { ptr._rot = { g: pq.clone().invert(), q0: q.clone() }; return !hand; }
  q.copy(pq).multiply(ptr._rot.g).multiply(ptr._rot.q0);  // q = (pq * grab^-1) * q0
  return !hand;                                           // controllers freeze the position while turning
}
