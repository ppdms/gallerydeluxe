import type { Photo } from "./types.js";
import type { Map as LeafletMap } from "leaflet";

export interface ViewerController {
  open(id: string, opener?: HTMLElement): void;
  close(): void;
  destroy(): void;
}

export interface ViewerOptions {
  syncImageQuery: boolean;
  enableExif: boolean;
  downloadLabel?: "Download original" | "Download original image" | "Open full size";
}

function formatAperture(val: string | number): string {
  if (typeof val === "number") {
    return `ƒ/${val}`;
  }
  if (typeof val === "string") {
    if (val.includes("/")) {
      const parts = val.split("/");
      const num = Number(parts[0]);
      const den = Number(parts[1]);
      if (den && !isNaN(num) && !isNaN(den)) {
        const result = (num / den).toFixed(1).replace(/\.0$/, "");
        return `ƒ/${result}`;
      }
    }
    return `ƒ/${val}`;
  }
  return String(val);
}

function formatDate(val: string): string {
  try {
    const d = new Date(val);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    }
  } catch {
    // Ignore formatting errors
  }
  return val;
}

export function createViewer(
  dialog: HTMLDialogElement,
  photos: readonly Photo[],
  options: ViewerOptions
): ViewerController {
  const downloadLabel = options.downloadLabel ?? "Download original image";
  let currentIndex = -1;
  let openerElement: HTMLElement | null = null;
  let currentGeneration = 0;
  let activeLeafletMap: LeafletMap | null = null;
  let openedViaPush = false;
  let savedScrollY = 0;
  let currentOriginalUrl = "";

  // Build photo index map
  const photoIndexMap = new Map<string, number>();
  for (let i = 0; i < photos.length; i++) {
    photoIndexMap.set(photos[i].id, i);
  }

  // Populate dialog structure
  dialog.innerHTML = `
    <div class="gd-viewer-shell" role="document">
      <header class="gd-viewer-header">
        <div class="gd-viewer-status" aria-live="polite"></div>
        <div class="gd-viewer-actions">
          <button type="button" class="gd-viewer-download" aria-label="${downloadLabel}">↓</button>
          <button type="button" class="gd-viewer-close" aria-label="Close photo viewer">
            ×
          </button>
        </div>
      </header>
      <div class="gd-viewer-main">
        <button type="button" class="gd-viewer-nav gd-viewer-prev" aria-label="Previous photo">
          <span aria-hidden="true">‹</span>
        </button>
        <div class="gd-viewer-stage">
          <div class="gd-viewer-image-wrapper"></div>
          <div class="gd-viewer-error" style="display: none;">
            <p>Photograph could not be loaded.</p>
            <button type="button" class="gd-viewer-retry">Retry</button>
          </div>
        </div>
        <button type="button" class="gd-viewer-nav gd-viewer-next" aria-label="Next photo">
          <span aria-hidden="true">›</span>
        </button>
      </div>
      <footer class="gd-viewer-footer">
        <div class="gd-viewer-caption"></div>
        <details class="gd-viewer-details" style="display: none;">
          <summary>Details</summary>
          <div class="gd-viewer-exif"></div>
        </details>
      </footer>
    </div>
  `;

  const statusEl = dialog.querySelector<HTMLElement>(".gd-viewer-status")!;
  const downloadButton = dialog.querySelector<HTMLButtonElement>(".gd-viewer-download")!;
  const closeBtn = dialog.querySelector<HTMLButtonElement>(".gd-viewer-close")!;
  const prevBtn = dialog.querySelector<HTMLButtonElement>(".gd-viewer-prev")!;
  const nextBtn = dialog.querySelector<HTMLButtonElement>(".gd-viewer-next")!;
  const imageWrapper = dialog.querySelector<HTMLElement>(".gd-viewer-image-wrapper")!;
  const errorEl = dialog.querySelector<HTMLElement>(".gd-viewer-error")!;
  const retryBtn = dialog.querySelector<HTMLButtonElement>(".gd-viewer-retry")!;
  const captionEl = dialog.querySelector<HTMLElement>(".gd-viewer-caption")!;
  const detailsEl = dialog.querySelector<HTMLDetailsElement>(".gd-viewer-details")!;
  const exifEl = dialog.querySelector<HTMLElement>(".gd-viewer-exif")!;
  let detailsFadeTimeout: ReturnType<typeof setTimeout> | undefined;

  downloadButton.title = downloadLabel;

  function destroyMap(): void {
    if (activeLeafletMap) {
      try {
        activeLeafletMap.remove();
      } catch {
        // Ignore map removal error
      }
      activeLeafletMap = null;
    }
  }

  function clearDetailsFade(): void {
    if (detailsFadeTimeout !== undefined) {
      clearTimeout(detailsFadeTimeout);
      detailsFadeTimeout = undefined;
    }
    detailsEl.classList.remove("gd-viewer-details-ontimeout");
  }

  function scheduleDetailsFade(generation: number): void {
    clearDetailsFade();
    detailsFadeTimeout = setTimeout(() => {
      if (generation === currentGeneration) {
        detailsEl.classList.add("gd-viewer-details-ontimeout");
      }
      detailsFadeTimeout = undefined;
    }, 1200);
  }

  function pickPreviewSource(photo: Photo): { src: string; width: number; height: number } {
    if (photo.sources.length === 0) {
      throw new Error(`Photograph ${photo.id} has no optimized sources`);
    }

    const previewLongEdge = 640;
    for (const source of photo.sources) {
      const longEdge = Math.max(source.width, source.height);
      if (longEdge >= previewLongEdge) {
        return source;
      }
    }

    return photo.sources[photo.sources.length - 1];
  }

  function renderExif(photo: Photo, generation: number): void {
    destroyMap();
    clearDetailsFade();
    if (!options.enableExif || !photo.exif) {
      detailsEl.style.display = "none";
      detailsEl.open = false;
      exifEl.textContent = "";
      return;
    }

    const exif = photo.exif;
    const rows: Array<{ label: string; value: string }> = [];

    if (exif.Date) {
      rows.push({ label: "Date", value: formatDate(exif.Date) });
    }

    if (exif.Tags) {
      if (exif.Tags.LensModel) {
        rows.push({ label: "Lens", value: String(exif.Tags.LensModel) });
      }
      if (exif.Tags.FocalLengthIn35mmFormat) {
        rows.push({ label: "Focal length", value: `${exif.Tags.FocalLengthIn35mmFormat}mm` });
      }
      if (exif.Tags.FNumber) {
        rows.push({ label: "Aperture", value: formatAperture(exif.Tags.FNumber) });
      }
      if (exif.Tags.ExposureTime) {
        rows.push({ label: "Shutter", value: `${exif.Tags.ExposureTime}s` });
      }
      if (exif.Tags.ISO) {
        rows.push({ label: "ISO", value: String(exif.Tags.ISO) });
      }
    }

    if (rows.length === 0 && (exif.Lat === undefined || exif.Long === undefined)) {
      detailsEl.style.display = "none";
      detailsEl.open = false;
      exifEl.textContent = "";
      return;
    }

    detailsEl.style.display = "";
    detailsEl.open = true;
    exifEl.textContent = "";

    const dl = document.createElement("dl");
    dl.className = "gd-exif-list";
    for (const row of rows) {
      const dt = document.createElement("dt");
      dt.textContent = row.label;
      const dd = document.createElement("dd");
      dd.textContent = row.value;
      dl.appendChild(dt);
      dl.appendChild(dd);
    }
    exifEl.appendChild(dl);

    // Map container for GPS coordinates
    const hasGps =
      exif.Lat !== undefined &&
      exif.Long !== undefined &&
      Number.isFinite(exif.Lat) &&
      Number.isFinite(exif.Long) &&
      (exif.Lat !== 0 || exif.Long !== 0) &&
      exif.Lat >= -90 &&
      exif.Lat <= 90 &&
      exif.Long >= -180 &&
      exif.Long <= 180;

    if (hasGps) {
      const lat = exif.Lat;
      const lng = exif.Long;
      if (lat === undefined || lng === undefined) return;

      const mapSection = document.createElement("div");
      mapSection.className = "gd-viewer-map-section";

      const googleMapsUrl =
        `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`;

      const mapContainer = document.createElement("div");
      mapContainer.className = "gd-viewer-map";
      mapContainer.setAttribute("role", "img");
      mapContainer.setAttribute("aria-label", "Photo location map");
      mapSection.appendChild(mapContainer);
      exifEl.appendChild(mapSection);

      void (async () => {
        try {
          const L = (await import("leaflet")).default;
          if (generation !== currentGeneration) return;

          if (!document.getElementById("leaflet-css")) {
            const link = document.createElement("link");
            link.id = "leaflet-css";
            link.rel = "stylesheet";
            link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
            document.head.appendChild(link);
          }

          const locationIcon = L.icon({
            iconRetinaUrl:
              "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
            iconUrl:
              "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
            shadowUrl:
              "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
            iconSize: [25, 41],
            iconAnchor: [12, 41],
            shadowSize: [41, 41],
          });

          destroyMap();
          const map = L.map(mapContainer).setView([lat, lng], 13);
          activeLeafletMap = map;

          L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19,
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
          }).addTo(map);

          const marker = L.marker([lat, lng], { icon: locationIcon }).addTo(map);
          marker.on("click", () => {
            window.open(googleMapsUrl, "_blank", "noopener,noreferrer");
          });
          requestAnimationFrame(() => map.invalidateSize());
        } catch {
          if (generation !== currentGeneration) return;
          const errP = document.createElement("p");
          errP.className = "gd-viewer-map-error";
          errP.textContent = "Location map could not be loaded.";
          mapSection.appendChild(errP);
        }
      })();
    }

    scheduleDetailsFade(generation);
  }

  function renderPhoto(index: number): void {
    if (index < 0 || index >= photos.length) return;
    currentIndex = index;
    const photo = photos[index];
    const generation = ++currentGeneration;

    // Status update
    statusEl.textContent = `${index + 1} of ${photos.length}`;

    // Download URL update (Download original or Open full size)
    currentOriginalUrl = photo.original;

    // Caption update
    if (photo.caption && photo.caption.trim()) {
      captionEl.textContent = photo.caption;
      captionEl.style.display = "";
    } else {
      captionEl.textContent = "";
      captionEl.style.display = "none";
    }

    // EXIF update
    renderExif(photo, generation);

    // Image loading
    imageWrapper.textContent = "";
    errorEl.style.display = "none";

    const previewSource = pickPreviewSource(photo);
    const alt =
      photo.alt || (photo.caption ? photo.caption : `Photograph ${index + 1} of ${photos.length}`);
    const previewImage = document.createElement("img");
    const originalImage = document.createElement("img");
    let previewFailed = false;
    let originalFailed = false;

    for (const image of [previewImage, originalImage]) {
      image.className = "gd-viewer-image";
      image.alt = alt;
      image.width = photo.width;
      image.height = photo.height;
      image.style.aspectRatio = `${photo.width} / ${photo.height}`;
      image.decoding = "async";
    }
    previewImage.classList.add("gd-viewer-thumbnail");

    const showImageError = () => {
      if (
        generation === currentGeneration &&
        currentIndex === index &&
        previewFailed &&
        originalFailed
      ) {
        errorEl.style.display = "block";
      }
    };

    previewImage.onload = () => {
      if (generation !== currentGeneration || currentIndex !== index) return;
      imageWrapper.appendChild(previewImage);
      if (originalImage.complete && originalImage.naturalWidth > 0) {
        previewImage.classList.add("gd-viewer-loaded");
      }
    };

    previewImage.onerror = () => {
      previewFailed = true;
      showImageError();
    };

    originalImage.onload = () => {
      if (generation !== currentGeneration || currentIndex !== index) return;
      imageWrapper.appendChild(originalImage);
      if (previewImage.parentElement) {
        previewImage.classList.add("gd-viewer-loaded");
      }
    };

    originalImage.onerror = () => {
      originalFailed = true;
      showImageError();
    };

    previewImage.src = previewSource.src;
    originalImage.src = photo.original;
  }

  function open(id: string, opener?: HTMLElement): void {
    const idx = photoIndexMap.get(id);
    if (idx === undefined) {
      console.warn(`Photograph not found: ${id}`);
      return;
    }

    if (opener) {
      openerElement = opener;
    }

    savedScrollY = window.scrollY;

    const hadImageQuery =
      options.syncImageQuery &&
      new URL(window.location.href).searchParams.get("image") !== null;

    if (!dialog.open) {
      dialog.showModal();
      closeBtn.focus();
    }

    if (options.syncImageQuery) {
      const url = new URL(window.location.href);
      if (url.searchParams.get("image") !== id) {
        url.searchParams.set("image", id);
        if (!hadImageQuery) {
          history.pushState({ galleryViewer: true, id }, "", url.toString());
          openedViaPush = true;
        } else {
          history.replaceState({ galleryViewer: true, id }, "", url.toString());
        }
      }
    }

    renderPhoto(idx);
  }

  function closeInternal(syncHistory: boolean): void {
    if (!dialog.open) return;

    currentGeneration++;
    clearDetailsFade();
    destroyMap();
    imageWrapper.textContent = "";
    errorEl.style.display = "none";

    dialog.close();
    document.documentElement.classList.remove("gd-image-deep-link");

    if (options.syncImageQuery && syncHistory) {
      if (openedViaPush) {
        history.back();
      } else {
        const url = new URL(window.location.href);
        if (url.searchParams.has("image")) {
          url.searchParams.delete("image");
          history.replaceState(null, "", url.toString());
        }
      }
    }
    openedViaPush = false;

    // Restore scroll position
    window.scrollTo(0, savedScrollY);

    // Restore focus
    if (openerElement && typeof openerElement.focus === "function") {
      openerElement.focus();
    } else {
      const heading = document.querySelector("h1");
      if (heading) {
        heading.setAttribute("tabindex", "-1");
        heading.focus();
      }
    }
  }

  function close(): void {
    closeInternal(true);
  }

  function showPrev(): void {
    if (photos.length <= 1 || currentIndex < 0) return;
    const nextIdx = (currentIndex - 1 + photos.length) % photos.length;
    const nextPhoto = photos[nextIdx];

    if (options.syncImageQuery) {
      const url = new URL(window.location.href);
      url.searchParams.set("image", nextPhoto.id);
      history.replaceState({ galleryViewer: true, id: nextPhoto.id }, "", url.toString());
    }

    renderPhoto(nextIdx);
  }

  function showNext(): void {
    if (photos.length <= 1 || currentIndex < 0) return;
    const nextIdx = (currentIndex + 1) % photos.length;
    const nextPhoto = photos[nextIdx];

    if (options.syncImageQuery) {
      const url = new URL(window.location.href);
      url.searchParams.set("image", nextPhoto.id);
      history.replaceState({ galleryViewer: true, id: nextPhoto.id }, "", url.toString());
    }

    renderPhoto(nextIdx);
  }

  // Event Listeners
  const onKeyDown = (e: KeyboardEvent) => {
    if (!dialog.open) return;
    const target = e.target instanceof HTMLElement ? e.target : null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) {
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      showPrev();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      showNext();
    }
  };

  // Touch Swipe Handling
  let touchStartX = 0;
  let touchStartY = 0;
  let isMultiTouch = false;

  const onTouchStart = (e: TouchEvent) => {
    if (!dialog.open) return;
    if (e.touches.length > 1) {
      isMultiTouch = true;
      return;
    }
    isMultiTouch = false;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  };

  const onTouchEnd = (e: TouchEvent) => {
    if (!dialog.open || isMultiTouch || e.changedTouches.length === 0) return;
    const touchEndX = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].clientY;

    const dx = touchEndX - touchStartX;
    const dy = touchEndY - touchStartY;

    // Dominant horizontal check and threshold 50px
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
      if (dx > 0) {
        showPrev();
      } else {
        showNext();
      }
    }
  };

  const onTouchCancel = () => {
    isMultiTouch = true;
  };

  const onPopState = () => {
    if (!options.syncImageQuery) return;
    const url = new URL(window.location.href);
    const id = url.searchParams.get("image");
    if (!id) {
      if (dialog.open) {
        closeInternal(false);
      }
    } else {
      const idx = photoIndexMap.get(id);
      if (idx !== undefined) {
        if (!dialog.open) {
          dialog.showModal();
          closeBtn.focus();
        }
        renderPhoto(idx);
      } else if (dialog.open) {
        closeInternal(false);
      }
    }
  };

  const onDialogCancel = (e: Event) => {
    e.preventDefault();
    close();
  };

  const onCloseClick = () => close();
  const onDownloadClick = () => {
    if (currentOriginalUrl) {
      window.open(currentOriginalUrl, "_blank");
    }
  };
  const onPrevClick = () => showPrev();
  const onNextClick = () => showNext();
  const onRetryClick = () => {
    if (currentIndex >= 0) renderPhoto(currentIndex);
  };

  closeBtn.addEventListener("click", onCloseClick);
  downloadButton.addEventListener("click", onDownloadClick);
  prevBtn.addEventListener("click", onPrevClick);
  nextBtn.addEventListener("click", onNextClick);
  retryBtn.addEventListener("click", onRetryClick);
  window.addEventListener("keydown", onKeyDown);
  dialog.addEventListener("touchstart", onTouchStart, { passive: true });
  dialog.addEventListener("touchend", onTouchEnd, { passive: true });
  dialog.addEventListener("touchcancel", onTouchCancel, { passive: true });
  dialog.addEventListener("cancel", onDialogCancel);
  window.addEventListener("popstate", onPopState);

  return {
    open,
    close,
    destroy() {
      const shouldClearImageQuery =
        options.syncImageQuery &&
        new URL(window.location.href).searchParams.has("image");
      if (dialog.open) {
        closeInternal(false);
      }
      if (shouldClearImageQuery) {
        const url = new URL(window.location.href);
        url.searchParams.delete("image");
        history.replaceState(null, "", url.toString());
      }
      currentGeneration++;
      clearDetailsFade();
      destroyMap();
      document.documentElement.classList.remove("gd-image-deep-link");
      closeBtn.removeEventListener("click", onCloseClick);
      downloadButton.removeEventListener("click", onDownloadClick);
      prevBtn.removeEventListener("click", onPrevClick);
      nextBtn.removeEventListener("click", onNextClick);
      retryBtn.removeEventListener("click", onRetryClick);
      window.removeEventListener("keydown", onKeyDown);
      dialog.removeEventListener("touchstart", onTouchStart);
      dialog.removeEventListener("touchend", onTouchEnd);
      dialog.removeEventListener("touchcancel", onTouchCancel);
      dialog.removeEventListener("cancel", onDialogCancel);
      window.removeEventListener("popstate", onPopState);
      if (dialog.open) {
        dialog.close();
      }
      dialog.innerHTML = "";
    },
  };
}
