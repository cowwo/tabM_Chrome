export function deriveNextAutoScrollFrame(params: {
  currentScrollTop: number;
  maxScrollTop: number;
  delta: number;
}): {
  nextScrollTop: number;
  didScroll: boolean;
} {
  const nextScrollTop = Math.max(0, Math.min(params.currentScrollTop + params.delta, params.maxScrollTop));
  return {
    nextScrollTop,
    didScroll: nextScrollTop !== params.currentScrollTop
  };
}

export function calculateAutoScrollDelta(params: {
  pointerClientY: number;
  containerTop: number;
  containerHeight: number;
  hotZoneSize: number;
  maxStep: number;
}): number {
  const { pointerClientY, containerTop, containerHeight, hotZoneSize, maxStep } = params;
  const containerBottom = containerTop + containerHeight;
  const topDistance = pointerClientY - containerTop;
  const bottomDistance = containerBottom - pointerClientY;
  const topDelta =
    topDistance >= 0 && topDistance < hotZoneSize
      ? -scaleStep({ distance: topDistance, hotZoneSize, maxStep })
      : 0;
  const bottomDelta =
    bottomDistance >= 0 && bottomDistance < hotZoneSize
      ? scaleStep({ distance: bottomDistance, hotZoneSize, maxStep })
      : 0;

  if (topDelta !== 0 && bottomDelta !== 0) {
    return topDistance <= bottomDistance ? topDelta : bottomDelta;
  }

  return topDelta || bottomDelta;
}

function scaleStep(params: {
  distance: number;
  hotZoneSize: number;
  maxStep: number;
}): number {
  const { distance, hotZoneSize, maxStep } = params;
  const ratio = (hotZoneSize - distance) / hotZoneSize;
  return Math.ceil(Math.max(0, ratio) * maxStep);
}
