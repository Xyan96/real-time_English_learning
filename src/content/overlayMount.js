export function getOverlayMountTarget(doc = document) {
  return doc.fullscreenElement || doc.webkitFullscreenElement || doc.documentElement;
}

export function shouldMoveOverlay(root, target) {
  if (!root || !target || typeof target.contains !== 'function') return false;
  return !target.contains(root);
}
