import type { PhotoGeometry } from "./types.js";
import { computeLayout } from "./layout.js";
import { readGalleryShells, resolveOrder } from "./shells.js";
import type { GalleryShell } from "./shells.js";

export interface ArrangeSheetOptions {
  /** Draw the display order from this session's stored shuffle. */
  shuffle?: boolean;
  /** Reverse the order when not shuffling. */
  reverse?: boolean;
}

/**
 * Chooses the arrangement for this visit and places every cell, then reveals
 * the sheet.
 *
 * Both halves have to happen before the first paint, or the visitor catches the
 * sheet part-way through being rearranged. That is why this is inlined next to
 * the markup and why it does no network work: the cells are already on the
 * page, so all that is left is deciding where each one goes.
 *
 * The sheet stays hidden until this returns. Without JavaScript it is never
 * hidden, so the stylesheet's own layout is what a visitor sees.
 */
export function arrangeSheet(
  container: HTMLElement,
  options: ArrangeSheetOptions = {}
): GalleryShell[] {
  const shells = readGalleryShells(container);
  if (shells.length === 0) return [];

  const ordered = resolveOrder(shells, options.shuffle === true, options.reverse === true);
  const list = shells[0].element.parentElement;
  if (list) {
    // DOM order is display order: it drives tab order, viewer navigation and
    // the reading order assistive technology sees.
    for (const [index, shell] of ordered.entries()) {
      list.appendChild(shell.element);
      // Numbered labels are only correct for the position a cell ends up in.
      const link = shell.element.querySelector<HTMLAnchorElement>("a[data-gd-label-auto]");
      if (link) {
        link.setAttribute("aria-label", `Open photo ${index + 1} of ${ordered.length}`);
      }
    }
  }

  const geometry: PhotoGeometry[] = ordered.map(({ id, width, height }) => ({
    id,
    width,
    height,
  }));

  let lastWidth = 0;

  function place(): boolean {
    const containerWidth = container.clientWidth;
    if (containerWidth <= 0) return false;
    lastWidth = containerWidth;

    const layout = computeLayout(geometry, containerWidth, window.innerWidth);
    container.style.height = `${layout.containerHeight}px`;
    // Cells inside the first screen should win the bandwidth race, and which
    // ones those are is only known once they hold positions: a wide viewport
    // shows several per row, so counting from the start of the arrangement
    // would prioritise barely any of them.
    const fold = window.innerHeight;

    for (const item of layout.items) {
      const shell = ordered[item.index];
      if (!shell) continue;
      const style = shell.element.style;
      style.left = `${item.left}px`;
      style.top = `${item.top}px`;
      style.width = `${item.width}px`;
      style.height = `${item.height}px`;
      if (shell.image) {
        shell.image.sizes = `${item.width}px`;
        // Everything below the fold keeps the lazy default and waits.
        shell.image.fetchPriority = item.top < fold ? "high" : "low";
      }
    }

    return true;
  }

  const placed = place();

  const resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      if (entry.contentRect.width > 0 && Math.abs(entry.contentRect.width - lastWidth) >= 1) {
        place();
        break;
      }
    }
  });
  resizeObserver.observe(container);

  // Cells are only revealed once they hold real positions; a sheet that could
  // not be measured falls back to the stylesheet's own layout instead.
  if (placed) {
    container.setAttribute("data-gd-ready", "");
  } else {
    document.documentElement.classList.remove("gd-js");
  }
  return ordered;
}

/**
 * Reports each cell's image as it arrives, and replaces a failed one with a
 * retry control. Delegated listeners keep this independent of how many cells
 * the sheet holds, so it can run long after the sheet was arranged.
 */
export function watchGalleryImages(container: HTMLElement): () => void {
  function failPhoto(image: HTMLImageElement): void {
    const figure = image.closest<HTMLElement>(".gd-photo-item");
    if (!figure || figure.hasAttribute("data-gd-error")) return;
    const shell = image.closest<HTMLAnchorElement>(".gd-photo-shell");
    const parent = figure.parentElement;
    const position = parent ? Array.prototype.indexOf.call(parent.children, figure) + 1 : 0;

    figure.setAttribute("data-gd-error", "");
    image.classList.remove("gd-loaded");
    if (shell) {
      shell.hidden = true;
      shell.setAttribute("aria-hidden", "true");
    }

    const errorContainer = document.createElement("div");
    errorContainer.className = "gd-photo-error";
    const errorLabel = document.createElement("span");
    errorLabel.className = "gd-error-label";
    errorLabel.textContent = `Photo ${position} unavailable`;
    const retryButton = document.createElement("button");
    retryButton.type = "button";
    retryButton.className = "gd-photo-retry";
    retryButton.textContent = "Retry";
    retryButton.addEventListener("click", () => {
      errorContainer.remove();
      figure.removeAttribute("data-gd-error");
      if (shell) {
        shell.hidden = false;
        shell.removeAttribute("aria-hidden");
      }
      // Re-request the same candidates. Cycling the attributes off and back on
      // is what makes the browser retry; a plain re-assignment would keep the
      // stale failure state.
      const srcset = image.getAttribute("srcset");
      const src = image.getAttribute("src");
      image.removeAttribute("srcset");
      image.removeAttribute("src");
      if (srcset !== null) image.setAttribute("srcset", srcset);
      if (src !== null) image.setAttribute("src", src);
    });
    errorContainer.append(errorLabel, retryButton);
    figure.appendChild(errorContainer);
  }

  function onLoad(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLImageElement && target.classList.contains("gd-photo-img")) {
      target.classList.add("gd-loaded");
    }
  }

  function onError(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLImageElement && target.classList.contains("gd-photo-img")) {
      failPhoto(target);
    }
  }

  container.addEventListener("load", onLoad, true);
  container.addEventListener("error", onError, true);
  // Opt into the fade-in: it must not hide images from visitors without JS.
  container.setAttribute("data-gd-enhanced", "");

  // Images that settled before this runtime attached.
  for (const image of container.querySelectorAll<HTMLImageElement>("img.gd-photo-img")) {
    if (!image.complete) continue;
    if (image.naturalWidth > 0) {
      image.classList.add("gd-loaded");
    } else {
      failPhoto(image);
    }
  }

  return () => {
    container.removeEventListener("load", onLoad, true);
    container.removeEventListener("error", onError, true);
    container.removeAttribute("data-gd-enhanced");
  };
}
