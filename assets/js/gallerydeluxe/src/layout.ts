import type { Photo } from "./types.js";

export interface FrameMetrics {
  side: number;
  top: number;
  caption: number;
  tilt: number;
  cardAspectRatio: number;
}

export interface PositionedItem {
  photo: Photo;
  index: number;
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface ComputedLayout {
  items: PositionedItem[];
  containerHeight: number;
}

const IMAGE_HEIGHT = 230;

/**
 * Derives the stable paper frame used by the original GalleryDeluxe contact
 * sheet. The hash keeps card details deterministic without storing layout data.
 */
export function getFrameMetrics(photo: Photo): FrameMetrics {
  let hash = 0;
  for (let i = 0; i < photo.id.length; i++) {
    hash += photo.id.charCodeAt(i);
  }

  const side = 10 + (hash % 5);
  const top = 10 + ((hash >> 2) % 4);
  const caption = 42 + ((hash >> 3) % 12);
  const tilt = ((hash % 13) - 6) * 0.34;
  const imageAspectRatio = photo.width / photo.height;
  const cardAspectRatio =
    (imageAspectRatio * IMAGE_HEIGHT + side * 2) / (IMAGE_HEIGHT + top + caption);

  return { side, top, caption, tilt, cardAspectRatio };
}

function getEdgePadding(viewportWidth: number): number {
  return Math.max(22, Math.min(76, Math.round(viewportWidth * 0.045)));
}

function getSpacing(viewportWidth: number): number {
  if (viewportWidth <= 480) return 18;
  return Math.max(28, Math.min(54, Math.round(viewportWidth * 0.026)));
}

function getMinimumRowAspect(viewportWidth: number): number {
  if (viewportWidth <= 480) return 1.05;
  if (viewportWidth <= 760) return 1.35;
  if (viewportWidth <= 1280) return 3.1;
  if (viewportWidth <= 1680) return 3.8;
  if (viewportWidth <= 2200) return 4.5;
  return 5.2;
}

/**
 * Computes the justified polaroid layout used by GalleryDeluxe.
 * Images remain independently lazy-mounted; this function only computes
 * stable card geometry from metadata and the current viewport width.
 */
export function computeLayout(
  photos: readonly Photo[],
  containerWidth: number,
  viewportWidth = containerWidth
): ComputedLayout {
  if (photos.length === 0 || containerWidth <= 0) {
    return { items: [], containerHeight: 0 };
  }

  const edgePadding = getEdgePadding(viewportWidth);
  const spacing = getSpacing(viewportWidth);
  const minimumRowAspect = getMinimumRowAspect(viewportWidth);
  const availableWidth = Math.max(containerWidth - edgePadding * 2, 1);
  const items: PositionedItem[] = [];
  let currentRow: Array<{ photo: Photo; index: number; aspectRatio: number }> = [];
  let currentY = edgePadding;
  let currentX = edgePadding;
  let rowAspectRatio = 0;

  const flushRow = (isLastRow = false): void => {
    if (currentRow.length === 0) return;

    const effectiveAspectRatio = isLastRow
      ? Math.max(rowAspectRatio, minimumRowAspect)
      : rowAspectRatio;
    const rowHeight = Math.max(
      1,
      Math.trunc((availableWidth - spacing * (currentRow.length - 1)) / effectiveAspectRatio)
    );

    for (let i = 0; i < currentRow.length; i++) {
      const rowItem = currentRow[i];
      const width = Math.max(1, Math.trunc(rowHeight * rowItem.aspectRatio));
      items.push({
        photo: rowItem.photo,
        index: rowItem.index,
        top: currentY,
        left: currentX,
        width,
        height: rowHeight,
      });
      currentX += width + spacing;
    }

    // Keep the next row anchored to the same edge even if integer rounding
    // leaves a few pixels unused on the right.
    currentY += rowHeight + spacing;
    currentX = edgePadding;
    currentRow = [];
    rowAspectRatio = 0;
  };

  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    const frame = getFrameMetrics(photo);
    currentRow.push({ photo, index: i, aspectRatio: frame.cardAspectRatio });
    rowAspectRatio += frame.cardAspectRatio;

    if (rowAspectRatio >= minimumRowAspect || i === photos.length - 1) {
      flushRow(i === photos.length - 1);
    }
  }

  return {
    items,
    containerHeight: Math.max(0, currentY - spacing + edgePadding),
  };
}
