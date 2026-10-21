/**
 * Keep the keyboard highlight in a comfortable reading band
 * (middle third, target ~40% from the top). In-band moves do not scroll.
 */
export const SOURCE_BAND_TOP = 0.28;
export const SOURCE_BAND_BOTTOM = 0.66;
export const SOURCE_BAND_TARGET = 0.4;

export function markScrollDelta({
  viewTop,
  viewHeight,
  markTop,
  markBottom,
  bandTopRatio = SOURCE_BAND_TOP,
  bandBottomRatio = SOURCE_BAND_BOTTOM,
  targetRatio = SOURCE_BAND_TARGET,
}) {
  const height = Number(viewHeight) || 0;
  if (height <= 0) return 0;
  const top = Number(viewTop) || 0;
  const boxTop = Number(markTop) || 0;
  const boxBottom = Number(markBottom) || boxTop;
  const bandTop = top + height * bandTopRatio;
  const bandBottom = top + height * bandBottomRatio;
  const markHeight = Math.max(0, boxBottom - boxTop);
  const bandHeight = height * (bandBottomRatio - bandTopRatio);
  if (markHeight >= bandHeight - 1) {
    if (boxTop >= bandTop && boxTop <= bandBottom) return 0;
    return boxTop - bandTop;
  }
  if (boxTop >= bandTop && boxBottom <= bandBottom) return 0;
  const markMid = (boxTop + boxBottom) / 2;
  return markMid - (top + height * targetRatio);
}

export function highlightMovingEdge(prev, next) {
  if (!next) return "mark";
  if (!prev) return "mark";
  if (next.end > prev.end) return "end";
  if (next.start < prev.start) return "start";
  if (next.start > prev.start) return "end";
  if (next.end < prev.end) return "start";
  return "mark";
}

export function markBoxForEdge(box, edge, probe = 22) {
  const top = Number(box?.top) || 0;
  const bottom = Number(box?.bottom) || top;
  const height = Math.max(0, bottom - top);
  const pad = Math.min(Math.max(Number(probe) || 22, 8), height || 22);
  if (edge === "end") return { markTop: bottom - pad, markBottom: bottom };
  if (edge === "start") return { markTop: top, markBottom: top + pad };
  return { markTop: top, markBottom: bottom };
}

export function markIsFullyVisible({ viewTop, viewHeight, markTop, markBottom }) {
  const top = Number(viewTop) || 0;
  const bottom = top + (Number(viewHeight) || 0);
  const boxTop = Number(markTop) || 0;
  const boxBottom = Number(markBottom) || boxTop;
  return boxBottom > top && boxTop < bottom;
}
