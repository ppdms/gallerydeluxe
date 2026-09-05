export interface ImageSource {
  src: string;
  width: number;
  height: number;
}

export interface Photo {
  id: string;
  width: number;
  height: number;
  alt: string;
  caption?: string;
  original: string;
  sources: ImageSource[];
  exif?: {
    Date?: string;
    Lat?: number;
    Long?: number;
    Tags?: Record<string, string | number>;
  };
}

export interface GalleryManifest {
  version: 1;
  images: Photo[];
}

function isValidUrl(url: unknown): url is string {
  if (typeof url !== "string" || !url.trim()) {
    return false;
  }
  if (url.startsWith("/") && !url.startsWith("//")) {
    return true;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function isWebpSourceUrl(url: string): boolean {
  const path = url.split(/[?#]/, 1)[0].toLowerCase();
  return path.endsWith(".webp");
}

export function parseManifest(value: unknown): GalleryManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid manifest: root must be an object");
  }

  const record = value as Record<string, unknown>;
  if (record.version !== 1) {
    throw new Error(
      `Invalid manifest version: expected 1, received ${JSON.stringify(record.version)}`
    );
  }

  if (!Array.isArray(record.images)) {
    throw new Error("Invalid manifest: images must be an array");
  }

  const seenIds = new Set<string>();
  const images: Photo[] = [];

  for (let i = 0; i < record.images.length; i++) {
    const item = record.images[i];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`Invalid manifest image at index ${i}: must be an object`);
    }

    const p = item as Record<string, unknown>;

    // ID validation
    if (typeof p.id !== "string" || !p.id.trim()) {
      throw new Error(
        `Invalid manifest image at index ${i}: id must be a non-empty string`
      );
    }
    if (seenIds.has(p.id)) {
      throw new Error(
        `Invalid manifest image at index ${i}: duplicate id ${JSON.stringify(p.id)}`
      );
    }
    seenIds.add(p.id);

    // Dimensions validation
    if (
      typeof p.width !== "number" ||
      !Number.isFinite(p.width) ||
      !Number.isInteger(p.width) ||
      p.width <= 0
    ) {
      throw new Error(
        `Invalid manifest image "${p.id}": width must be a positive integer, received ${p.width}`
      );
    }
    if (
      typeof p.height !== "number" ||
      !Number.isFinite(p.height) ||
      !Number.isInteger(p.height) ||
      p.height <= 0
    ) {
      throw new Error(
        `Invalid manifest image "${p.id}": height must be a positive integer, received ${p.height}`
      );
    }

    // Alt validation
    if (typeof p.alt !== "string") {
      throw new Error(
        `Invalid manifest image "${p.id}": alt must be a string (can be empty)`
      );
    }

    // Caption (optional)
    let caption: string | undefined;
    if (p.caption !== undefined) {
      if (typeof p.caption !== "string") {
        throw new Error(
          `Invalid manifest image "${p.id}": caption must be a string if provided`
        );
      }
      caption = p.caption;
    }

    // Original URL validation
    if (!isValidUrl(p.original)) {
      throw new Error(
        `Invalid manifest image "${p.id}": original must be a valid HTTP(S) or root-relative URL`
      );
    }

    // Sources validation
    if (!Array.isArray(p.sources) || p.sources.length === 0) {
      throw new Error(
        `Invalid manifest image "${p.id}": sources must be a non-empty array`
      );
    }

    const sources: ImageSource[] = [];
    let prevWidth = 0;
    for (let sIdx = 0; sIdx < p.sources.length; sIdx++) {
      const s = p.sources[sIdx];
      if (!s || typeof s !== "object" || Array.isArray(s)) {
        throw new Error(
          `Invalid source at index ${sIdx} for image "${p.id}": must be an object`
        );
      }
      const srcRecord = s as Record<string, unknown>;
      if (!isValidUrl(srcRecord.src)) {
        throw new Error(
          `Invalid source src at index ${sIdx} for image "${p.id}": must be a valid HTTP(S) or root-relative URL`
        );
      }
      if (!isWebpSourceUrl(srcRecord.src)) {
        throw new Error(
          `Invalid source src at index ${sIdx} for image "${p.id}": sources must be WebP derivatives`
        );
      }
      if (
        typeof srcRecord.width !== "number" ||
        !Number.isFinite(srcRecord.width) ||
        !Number.isInteger(srcRecord.width) ||
        srcRecord.width <= 0
      ) {
        throw new Error(
          `Invalid source width at index ${sIdx} for image "${p.id}": must be a positive integer`
        );
      }
      if (
        typeof srcRecord.height !== "number" ||
        !Number.isFinite(srcRecord.height) ||
        !Number.isInteger(srcRecord.height) ||
        srcRecord.height <= 0
      ) {
        throw new Error(
          `Invalid source height at index ${sIdx} for image "${p.id}": must be a positive integer`
        );
      }

      if (srcRecord.width <= prevWidth) {
        throw new Error(
          `Invalid sources for image "${p.id}": sources must be sorted by strictly increasing width`
        );
      }
      prevWidth = srcRecord.width;

      sources.push({
        src: srcRecord.src,
        width: srcRecord.width,
        height: srcRecord.height,
      });
    }

    // EXIF (optional)
    let exif: Photo["exif"];
    if (p.exif !== undefined) {
      if (!p.exif || typeof p.exif !== "object" || Array.isArray(p.exif)) {
        throw new Error(
          `Invalid exif for image "${p.id}": must be an object if provided`
        );
      }
      const e = p.exif as Record<string, unknown>;
      exif = {};
      if (e.Date !== undefined) {
        if (typeof e.Date !== "string") {
          throw new Error(
            `Invalid exif.Date for image "${p.id}": must be a string`
          );
        }
        exif.Date = e.Date;
      }
      if (e.Lat !== undefined) {
        if (typeof e.Lat !== "number" || !Number.isFinite(e.Lat)) {
          throw new Error(
            `Invalid exif.Lat for image "${p.id}": must be a finite number`
          );
        }
        exif.Lat = e.Lat;
      }
      if (e.Long !== undefined) {
        if (typeof e.Long !== "number" || !Number.isFinite(e.Long)) {
          throw new Error(
            `Invalid exif.Long for image "${p.id}": must be a finite number`
          );
        }
        exif.Long = e.Long;
      }
      if (e.Tags !== undefined) {
        if (!e.Tags || typeof e.Tags !== "object" || Array.isArray(e.Tags)) {
          throw new Error(
            `Invalid exif.Tags for image "${p.id}": must be an object`
          );
        }
        const tags: Record<string, string | number> = {};
        for (const [tKey, tVal] of Object.entries(e.Tags as Record<string, unknown>)) {
          if (typeof tVal === "string" || typeof tVal === "number") {
            tags[tKey] = tVal;
          }
        }
        exif.Tags = tags;
      }
    }

    images.push({
      id: p.id,
      width: p.width,
      height: p.height,
      alt: p.alt,
      caption,
      original: p.original,
      sources,
      exif,
    });
  }

  return {
    version: 1,
    images,
  };
}
