import type { GalleryManifest, Photo } from "./types.js";
import { computeLayout, getFrameMetrics } from "./layout.js";
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

const STORAGE_KEY = "gallerydeluxe-order-v1";

function formatGalleryLabel(photo: Photo): { title: string; meta?: string } {
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
        parts.length === 2 && denominator
          ? numerator / denominator
          : Number(raw);
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

function resolvePhotoOrder(
  manifest: GalleryManifest,
  shuffle: boolean,
  reverse?: boolean
): Photo[] {
  const originalPhotos = [...manifest.images];
  if (originalPhotos.length === 0) {
    return [];
  }

  if (!shuffle) {
    if (reverse) {
      originalPhotos.reverse();
    }
    return originalPhotos;
  }

  // Try retrieving stored order from sessionStorage
  try {
    const rawStored = sessionStorage.getItem(STORAGE_KEY);
    if (rawStored) {
      const storedIds: unknown = JSON.parse(rawStored);
      if (Array.isArray(storedIds) && storedIds.length === originalPhotos.length) {
        const manifestIds = new Set(originalPhotos.map((p) => p.id));
        const storedIdSet = new Set<string>();
        const allMatch = storedIds.every((id): id is string => {
          if (typeof id !== "string" || !manifestIds.has(id)) return false;
          storedIdSet.add(id);
          return true;
        });
        if (allMatch && storedIdSet.size === manifestIds.size) {
          const photoMap = new Map(originalPhotos.map((p) => [p.id, p]));
          return storedIds.map((id) => photoMap.get(id)!);
        }
      }
    }
  } catch {
    // sessionStorage unavailable or parse error; fallback to in-memory shuffle
  }

  // In-place Fisher-Yates shuffle
  const shuffled = [...originalPhotos];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = temp;
  }

  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(shuffled.map((p) => p.id)));
  } catch {
    // sessionStorage write failed; in-memory order is maintained
  }

  return shuffled;
}

export function mountGallery(
  container: HTMLElement,
  manifest: GalleryManifest,
  options: MountGalleryOptions
): GalleryController {
  if (manifest.images.length === 0) {
    container.innerHTML = '<p class="gd-empty">No photographs yet.</p>';
    return { destroy() {} };
  }

  const orderedPhotos = resolvePhotoOrder(manifest, options.shuffle, options.reverse);

  // Initialize shared viewer
  const viewer: ViewerController = createViewer(options.dialog, orderedPhotos, {
    syncImageQuery: true,
    enableExif: options.enableExif,
  });

  // Create ordered list of lightweight shells
  container.innerHTML = "";
  container.classList.add("gd-contact-sheet");
  container.style.position = "relative";
  const photoList = document.createElement("div");
  photoList.className = "gd-photo-list";
  photoList.style.margin = "0";
  photoList.style.padding = "0";
  container.appendChild(photoList);

  interface ShellRecord {
    listItem: HTMLElement;
    shell: HTMLAnchorElement;
    photo: Photo;
    index: number;
    imgElement: HTMLImageElement | null;
    errorElement: HTMLDivElement | null;
    isError: boolean;
    generation: number;
  }

  const shellRecords: ShellRecord[] = [];
  const recordsById = new Map<string, ShellRecord>();
  let destroyed = false;

  for (let i = 0; i < orderedPhotos.length; i++) {
    const photo = orderedPhotos[i];
    const listItem = document.createElement("figure");
    listItem.className = `gd-photo-item gd-figure gd-frame-${i % 8}`;
    listItem.style.position = "absolute";
    const frame = getFrameMetrics(photo);
    listItem.style.setProperty("--gd-polaroid-side", `${frame.side}px`);
    listItem.style.setProperty("--gd-polaroid-top", `${frame.top}px`);
    listItem.style.setProperty("--gd-polaroid-caption", `${frame.caption}px`);
    listItem.style.setProperty("--gd-paper-tint", "#fffdf6");
    listItem.style.setProperty("--gd-tilt", `${frame.tilt}deg`);

    const galleryLabel = formatGalleryLabel(photo);
    const labelElement = document.createElement("figcaption");
    labelElement.className = "gd-label";
    labelElement.setAttribute("aria-hidden", "true");
    const titleElement = document.createElement("span");
    titleElement.className = "gd-label-title";
    titleElement.textContent = galleryLabel.title;
    labelElement.appendChild(titleElement);
    if (galleryLabel.meta) {
      const metaElement = document.createElement("span");
      metaElement.className = "gd-label-meta";
      metaElement.textContent = galleryLabel.meta;
      labelElement.appendChild(metaElement);
    }

    const shell = document.createElement("a");
    shell.className = "gd-photo-shell";
    shell.dataset.id = photo.id;
    shell.style.position = "absolute";
    shell.style.inset = "0";
    shell.style.display = "block";
    shell.style.overflow = "visible";

    const label = photo.caption || photo.alt || `Open photo ${i + 1} of ${orderedPhotos.length}`;
    shell.setAttribute("aria-label", label);

    // Grid link points to largest candidate derivative
    const gridCandidates = photo.sources.filter(
      (s) => Math.max(s.width, s.height) <= 1280
    );
    const candidateList = gridCandidates.length > 0 ? gridCandidates : photo.sources;
    const largestCandidate = candidateList[candidateList.length - 1];
    shell.href = largestCandidate.src;

    const record: ShellRecord = {
      listItem,
      shell,
      photo,
      index: i,
      imgElement: null,
      errorElement: null,
      isError: false,
      generation: 0,
    };

    shell.addEventListener("click", (e) => {
      e.preventDefault();
      viewer.open(photo.id, shell);
    });

    shell.addEventListener("focus", () => {
      // Mount image on focus before scrolling into view
      if (!record.imgElement && !record.isError) {
        mountImage(record);
      }
    });

    listItem.append(labelElement, shell);
    photoList.appendChild(listItem);
    shellRecords.push(record);
    recordsById.set(photo.id, record);
  }

  function mountImage(record: ShellRecord): void {
    if (destroyed || record.imgElement || record.isError) return;
    const generation = ++record.generation;
    const photo = record.photo;

    const gridCandidates = photo.sources.filter(
      (s) => Math.max(s.width, s.height) <= 1280
    );
    const candidates = gridCandidates.length > 0 ? gridCandidates : photo.sources;
    if (candidates.length === 0) return;

    const img = document.createElement("img");
    img.className = "gd-photo-img";
    img.alt = photo.alt || "";
    img.decoding = "async";
    // IntersectionObserver already bounds how many images exist in the DOM.
    // Do not add a second native lazy gate: Firefox can defer an absolutely
    // positioned image indefinitely even after our observer mounted it.
    img.loading = "eager";

    // Set sizes to computed CSS width
    const shellWidth = record.shell.offsetWidth || record.shell.clientWidth;
    if (shellWidth > 0) {
      img.sizes = `${shellWidth}px`;
    }

    img.srcset = candidates.map((s) => `${s.src} ${s.width}w`).join(", ");
    img.src = candidates[candidates.length - 1].src;

    img.onload = () => {
      if (
        destroyed ||
        record.generation !== generation ||
        record.imgElement !== img
      ) {
        return;
      }
      img.classList.add("gd-loaded");
    };

    img.onerror = () => {
      if (
        destroyed ||
        record.generation !== generation ||
        record.imgElement !== img
      ) {
        return;
      }
      record.isError = true;
      record.generation++;
      record.imgElement = null;
      img.onload = null;
      img.onerror = null;
      img.removeAttribute("src");
      img.removeAttribute("srcset");

      // Stable placeholder with Retry control
      record.shell.innerHTML = "";
      record.shell.hidden = true;
      record.shell.setAttribute("aria-hidden", "true");
      const errorContainer = document.createElement("div");
      errorContainer.className = "gd-photo-error";
      const errorLabel = document.createElement("span");
      errorLabel.className = "gd-error-label";
      errorLabel.textContent = `Photo ${record.index + 1} unavailable`;
      const retryBtn = document.createElement("button");
      retryBtn.type = "button";
      retryBtn.className = "gd-photo-retry";
      retryBtn.textContent = "Retry";
      errorContainer.append(errorLabel, retryBtn);
      retryBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        record.isError = false;
        record.errorElement?.remove();
        record.errorElement = null;
        record.shell.innerHTML = "";
        record.shell.hidden = false;
        record.shell.removeAttribute("aria-hidden");
        mountImage(record);
      });
      record.errorElement = errorContainer;
      record.listItem.appendChild(errorContainer);
    };

    record.imgElement = img;
    record.shell.appendChild(img);
  }

  function unmountImage(record: ShellRecord): void {
    // Keep focused shell image alive
    if (document.activeElement === record.shell) return;
    if (record.imgElement) {
      record.generation++;
      const img = record.imgElement;
      img.onload = null;
      img.onerror = null;
      img.removeAttribute("src");
      img.removeAttribute("srcset");
      if (img.parentElement === record.shell) {
        record.shell.removeChild(img);
      }
      record.imgElement = null;
    }
  }

  // Setup IntersectionObserver for responsive lazy mounting
  let isSaveData = false;
  if (typeof navigator !== "undefined" && "connection" in navigator) {
    const conn = navigator.connection;
    if (conn && typeof conn === "object" && "saveData" in conn) {
      isSaveData = Boolean(conn.saveData);
    }
  }

  const rootMargin = isSaveData ? "200px 0px 200px 0px" : "600px 0px 600px 0px";

  const intersectionObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!(entry.target instanceof HTMLAnchorElement)) continue;
        const shell = entry.target;
        const id = shell.dataset.id;
        const record = id ? recordsById.get(id) : undefined;
        if (!record) continue;

        if (entry.isIntersecting) {
          mountImage(record);
        } else {
          unmountImage(record);
        }
      }
    },
    { rootMargin }
  );

  for (const record of shellRecords) {
    intersectionObserver.observe(record.shell);
  }

  // Layout computation & ResizeObserver
  let rafId: number | null = null;
  let lastObservedWidth = 0;

  function updateLayout(): void {
    const containerWidth = container.clientWidth;
    if (containerWidth <= 0) return;
    lastObservedWidth = containerWidth;

    const layout = computeLayout(orderedPhotos, containerWidth, window.innerWidth);
    container.style.height = `${layout.containerHeight}px`;

    for (let i = 0; i < layout.items.length; i++) {
      const item = layout.items[i];
      const record = shellRecords[item.index];
      if (!record) continue;

      record.listItem.style.left = `${item.left}px`;
      record.listItem.style.top = `${item.top}px`;
      record.listItem.style.width = `${item.width}px`;
      record.listItem.style.height = `${item.height}px`;

      if (record.imgElement) {
        record.imgElement.sizes = `${item.width}px`;
      }
    }
  }

  const resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const width = entry.contentRect.width;
      if (Math.abs(width - lastObservedWidth) >= 1) {
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
        }
        rafId = requestAnimationFrame(() => {
          rafId = null;
          updateLayout();
        });
      }
    }
  });

  resizeObserver.observe(container);
  updateLayout();

  // Initial ?image= check on deep link
  const searchParams = new URL(window.location.href).searchParams;
  const hasImageParam = searchParams.has("image");
  const initialImageId = searchParams.get("image");
  if (hasImageParam) {
    const photoIndex =
      initialImageId === null
        ? -1
        : orderedPhotos.findIndex((p) => p.id === initialImageId);
    if (initialImageId !== null && photoIndex >= 0) {
      viewer.open(initialImageId);
    } else {
      const notFoundMsg = document.createElement("div");
      notFoundMsg.className = "gd-not-found";
      notFoundMsg.textContent = "Photograph not found.";
      notFoundMsg.style.margin = "1rem 0";
      container.parentElement?.insertBefore(notFoundMsg, container);
    }
  }

  return {
    destroy() {
      destroyed = true;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      for (const record of shellRecords) {
        record.generation++;
        unmountImage(record);
      }
      container.innerHTML = "";
      viewer.destroy();
    },
  };
}
