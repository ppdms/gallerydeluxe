import * as params from "@params";
import { mountGallery } from "../src/gallery.js";
import { parseManifest } from "../src/types.js";

async function init(): Promise<void> {
  const container = document.getElementById("gallerydeluxe");
  if (!container) return;

  const dataUrl = container.dataset.src || params.gallery_data_url;
  if (!dataUrl) {
    console.error("GalleryDeluxe: No gallery data URL found");
    return;
  }

  // Find or create dialog element
  const existingDialog = document.getElementById("gd-viewer");
  const dialog =
    existingDialog instanceof HTMLDialogElement
      ? existingDialog
      : document.createElement("dialog");
  if (!(existingDialog instanceof HTMLDialogElement)) {
    dialog.id = "gd-viewer";
    dialog.className = "gd-viewer";
    container.parentElement?.appendChild(dialog);
  }

  try {
    const response = await fetch(dataUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching gallery data`);
    }
    const rawData = await response.json();
    const manifest = parseManifest(rawData);

    const shuffle = params.shuffle !== false;
    const reverse = Boolean(params.reverse);
    const enableExif = Boolean(params.enable_exif);

    mountGallery(container, manifest, {
      shuffle,
      reverse,
      enableExif,
      dialog,
    });
  } catch (err) {
    console.error("GalleryDeluxe failed to initialize:", err);
    container.innerHTML = '<p class="gd-error">The gallery could not be loaded.</p>';
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    void init();
  });
} else {
  void init();
}
