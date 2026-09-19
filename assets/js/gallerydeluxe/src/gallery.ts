import type { GalleryManifest, Photo } from "./types.js";
import { arrangeSheet, watchGalleryImages } from "./runtime.js";
import { readGalleryPhotos, renderGalleryShells, renderViewerData } from "./shells.js";
import { createViewer } from "./viewer.js";
import type { ViewerController } from "./viewer.js";

export interface GalleryController {
  destroy(): void;
}

export interface MountGalleryOptions {
  shuffle: boolean;
  reverse?: boolean;
  enableExif: boolean;
  dialog: HTMLDialogElement;
}

/**
 * Opens the photograph named by `?image=`, or reports that it is unknown.
 * Deep links are resolved after the sheet exists so the viewer can be handed a
 * display-ordered photo list.
 */
export function openDeepLinkedPhoto(
  container: HTMLElement,
  viewer: ViewerController,
  photos: readonly Photo[]
): void {
  const params = new URL(window.location.href).searchParams;
  if (!params.has("image")) return;

  const id = params.get("image");
  if (id !== null && photos.some((photo) => photo.id === id)) {
    viewer.open(id);
    return;
  }

  const message = document.createElement("div");
  message.className = "gd-not-found";
  message.textContent = "Photograph not found.";
  message.style.margin = "1rem 0";
  container.parentElement?.insertBefore(message, container);
}

/**
 * Renders the full contact sheet and wires it to a photo viewer. Used where no
 * server can pre-render the markup; static pages emit `renderGalleryShells`
 * instead and only need the arrangement and viewer halves.
 */
export function mountGallery(
  container: HTMLElement,
  manifest: GalleryManifest,
  options: MountGalleryOptions
): GalleryController {
  if (manifest.images.length === 0) {
    container.innerHTML = '<p class="gd-empty">No photographs yet.</p>';
    return {
      destroy() {
        container.innerHTML = "";
      },
    };
  }

  container.classList.add("gd-contact-sheet");
  container.innerHTML = `<div class="gd-photo-list">${renderGalleryShells(manifest.images)}</div>`;
  container.insertAdjacentHTML(
    "afterend",
    `<script type="application/json" data-gd-viewer-data>${renderViewerData(manifest.images)}</script>`
  );

  arrangeSheet(container, {
    shuffle: options.shuffle,
    reverse: options.reverse,
  });
  const stopWatching = watchGalleryImages(container);

  const dataElement = container.nextElementSibling;
  const viewerData = dataElement instanceof HTMLElement ? dataElement.textContent || "[]" : "[]";
  const photos = readGalleryPhotos(container, viewerData);

  const viewer = createViewer(options.dialog, photos, {
    syncImageQuery: true,
    enableExif: options.enableExif,
  });

  const links = container.querySelectorAll<HTMLAnchorElement>(".gd-photo-shell");
  function onClick(event: MouseEvent): void {
    const link = event.currentTarget;
    if (!(link instanceof HTMLAnchorElement)) return;
    event.preventDefault();
    const id = link.closest<HTMLElement>(".gd-photo-item")?.dataset.id;
    if (id) viewer.open(id, link);
  }
  for (const link of links) {
    link.addEventListener("click", onClick);
  }

  openDeepLinkedPhoto(container, viewer, photos);

  return {
    destroy() {
      for (const link of links) {
        link.removeEventListener("click", onClick);
      }
      stopWatching();
      viewer.destroy();
      dataElement?.remove();
      container.innerHTML = "";
    },
  };
}
