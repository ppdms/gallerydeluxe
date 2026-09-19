import type { Photo } from "./types.js";
import { getFrameMetrics } from "./layout.js";

export interface GalleryLabel {
  title: string;
  meta?: string;
}

/** Largest derivative a contact-sheet cell should reference. */
const GRID_MAX_EDGE = 1280;

const FRAME_VARIANTS = 8;

/**
 * Source-size hint for browsers that cannot yet report the rendered width
 * themselves. The arrangement script refines it for the cells in view.
 */
const IMAGE_SIZES =
  "(max-width: 480px) 80vw, (max-width: 760px) 45vw, (max-width: 1280px) 24vw, (max-width: 1680px) 18vw, 15vw";

const ORDER_STORAGE_KEY = "gallerydeluxe-order-v1";

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Derivatives small enough to render a contact-sheet cell. */
function selectGridSources(photo: Photo): Photo["sources"] {
  const candidates = photo.sources.filter(
    (source) => Math.max(source.width, source.height) <= GRID_MAX_EDGE
  );
  return candidates.length > 0 ? candidates : photo.sources;
}

/** The handwritten caption printed on the paper frame. */
function formatGalleryLabel(photo: Photo): GalleryLabel {
  let title = photo.id.slice(0, 6).toUpperCase();
  const meta: string[] = [];
  const exif = photo.exif;

  if (exif?.Date) {
    const date = new Date(exif.Date);
    if (!Number.isNaN(date.getTime())) {
      title = date.toLocaleDateString(undefined, {
        month: "short",
        year: "numeric",
      });
    }
  }

  const tags = exif?.Tags;
  if (tags) {
    if (tags.FocalLengthIn35mmFormat) {
      meta.push(`${tags.FocalLengthIn35mmFormat}mm`);
    }
    if (tags.FNumber !== undefined) {
      const raw = String(tags.FNumber);
      const parts = raw.split("/");
      const numerator = Number(parts[0]);
      const denominator = Number(parts[1]);
      const aperture =
        parts.length === 2 && denominator ? numerator / denominator : Number(raw);
      if (Number.isFinite(aperture)) {
        meta.push(`f/${aperture.toFixed(1)}`);
      }
    }
    if (tags.ISO) {
      meta.push(`ISO ${tags.ISO}`);
    }
  }

  return { title, meta: meta.slice(0, 3).join(" / ") || undefined };
}

/**
 * Renders every contact-sheet cell as HTML, in the order given. The stylesheet
 * both places and sizes the cells, so this markup is complete and correctly
 * laid out before any script runs; only the arrangement is left to the runtime.
 */
export function renderGalleryShells(photos: readonly Photo[]): string {
  let html = "";

  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    const frame = getFrameMetrics(photo);
    const sources = selectGridSources(photo);
    const fallbackSource = sources[sources.length - 1];
    const href = fallbackSource ? fallbackSource.src : photo.original;
    const description = photo.caption || photo.alt;
    const galleryLabel = formatGalleryLabel(photo);
    const srcset = sources
      .map((source) => `${escapeAttribute(source.src)} ${source.width}w`)
      .join(", ");

    html +=
      `<figure class="gd-photo-item gd-figure gd-frame-${i % FRAME_VARIANTS}"` +
      ` data-id="${escapeAttribute(photo.id)}"` +
      ` data-w="${photo.width}" data-h="${photo.height}"` +
      ` style="--gd-polaroid-side:${frame.side}px;--gd-polaroid-top:${frame.top}px;` +
      `--gd-polaroid-caption:${frame.caption}px;--gd-tilt:${frame.tilt}deg;` +
      `--gd-card-ar:${frame.cardAspectRatio}">`;
    html += `<figcaption class="gd-label" aria-hidden="true">`;
    html += `<span class="gd-label-title">${escapeText(galleryLabel.title)}</span>`;
    if (galleryLabel.meta) {
      html += `<span class="gd-label-meta">${escapeText(galleryLabel.meta)}</span>`;
    }
    html += `</figcaption>`;
    // Cells without a description get a numbered label from the arrangement
    // runtime, which is the only place that knows the final position.
    html += `<a class="gd-photo-shell"` +
      ` href="${escapeAttribute(href)}"` +
      (description
        ? ` aria-label="${escapeAttribute(description)}"`
        : ` data-gd-label-auto="" aria-label="${escapeAttribute(
            `Open photo ${i + 1} of ${photos.length}`
          )}"`) +
      `>`;
    html += `<img class="gd-photo-img" src="${escapeAttribute(href)}"` +
      ` srcset="${srcset}" sizes="${IMAGE_SIZES}"` +
      ` loading="lazy" decoding="async" alt="${escapeAttribute(photo.alt ?? "")}">`;
    html += `</a></figure>`;
  }

  return html;
}

/** A rendered contact-sheet cell: its geometry plus the nodes to fill in. */
export interface GalleryShell {
  id: string;
  width: number;
  height: number;
  element: HTMLElement;
  image: HTMLImageElement | null;
}

/** Reads rendered cells back out of the document, in DOM (display) order. */
export function readGalleryShells(root: ParentNode): GalleryShell[] {
  const shells: GalleryShell[] = [];
  const elements = root.querySelectorAll<HTMLElement>(".gd-photo-item[data-id]");

  for (const element of elements) {
    const id = element.dataset.id;
    const width = Number(element.dataset.w);
    const height = Number(element.dataset.h);
    if (!id || !Number.isFinite(width) || !Number.isFinite(height)) continue;
    shells.push({
      id,
      width,
      height,
      element,
      image: element.querySelector<HTMLImageElement>("img.gd-photo-img"),
    });
  }

  return shells;
}

/** `[id, original, caption, exif]` — the photo fields a cell cannot carry. */
type ViewerDataRow = [string, string, string, Photo["exif"] | null];

/** The viewer-only fields for every photo, as a JSON island. */
export function renderViewerData(photos: readonly Photo[]): string {
  const rows: ViewerDataRow[] = photos.map((photo) => [
    photo.id,
    photo.original,
    photo.caption ?? "",
    photo.exif ?? null,
  ]);
  return JSON.stringify(rows).replaceAll("<", "\\u003c");
}

/**
 * Rebuilds the photo list from rendered cells plus the viewer data island, in
 * DOM (display) order. Sources come from the `srcset` the grid was given, so
 * the viewer can only offer candidates the grid itself advertised.
 */
export function readGalleryPhotos(root: ParentNode, viewerData: string): Photo[] {
  const viewerFields = new Map<string, ViewerDataRow>();
  const rows: unknown = JSON.parse(viewerData);
  if (Array.isArray(rows)) {
    for (const row of rows) {
      if (Array.isArray(row) && typeof row[0] === "string" && typeof row[1] === "string") {
        viewerFields.set(row[0], row as ViewerDataRow);
      }
    }
  }

  const photos: Photo[] = [];
  for (const shell of readGalleryShells(root)) {
    const fields = viewerFields.get(shell.id);
    if (!fields) continue;

    const sources: Photo["sources"] = [];
    const srcset = shell.image?.getAttribute("srcset");
    if (srcset) {
      for (const candidate of srcset.split(",")) {
        const [src, descriptor] = candidate.trim().split(/\s+/);
        const width = Number.parseInt(descriptor ?? "", 10);
        if (!src || !Number.isFinite(width) || width <= 0) continue;
        // Heights are not repeated per candidate; the photo's own ratio
        // reproduces them to within a pixel.
        sources.push({ src, width, height: Math.round((width * shell.height) / shell.width) });
      }
    }

    photos.push({
      id: shell.id,
      width: shell.width,
      height: shell.height,
      alt: shell.image?.alt ?? "",
      ...(fields[2] ? { caption: fields[2] } : {}),
      original: fields[1],
      sources,
      ...(fields[3] ? { exif: fields[3] } : {}),
    });
  }

  return photos;
}

/**
 * Resolves the display order. When shuffling is requested the order is drawn
 * from `sessionStorage` first so a visitor sees the same contact sheet while
 * they browse, and is persisted for the rest of the session.
 */
export function resolveOrder<T extends { id: string }>(
  items: readonly T[],
  shuffle: boolean,
  reverse?: boolean
): T[] {
  const original = [...items];
  if (original.length === 0) return [];

  if (!shuffle) {
    if (reverse) {
      original.reverse();
    }
    return original;
  }

  try {
    const rawStored = sessionStorage.getItem(ORDER_STORAGE_KEY);
    if (rawStored) {
      const storedIds: unknown = JSON.parse(rawStored);
      if (Array.isArray(storedIds) && storedIds.length === original.length) {
        const itemMap = new Map(original.map((item) => [item.id, item]));
        const ordered: T[] = [];
        for (const id of storedIds) {
          if (typeof id !== "string") break;
          const item = itemMap.get(id);
          if (!item) break;
          itemMap.delete(id);
          ordered.push(item);
        }
        if (ordered.length === original.length) {
          return ordered;
        }
      }
    }
  } catch {
    // sessionStorage unavailable or parse error; fall back to a fresh shuffle
  }

  const shuffled = [...original];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = temp;
  }

  try {
    sessionStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(shuffled.map((item) => item.id)));
  } catch {
    // sessionStorage write failed; the in-memory order still holds
  }

  return shuffled;
}
