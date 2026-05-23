import { mkdir, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PressError } from "@pressh/core";
import type { AuditLog, StorageAdapter, StoredDoc } from "@pressh/core";

/**
 * Upload validation (baseline #13). A file is accepted only if its extension is
 * whitelisted, its declared content-type matches, AND its leading magic bytes
 * match the claimed type. This rejects disguised executables/polyglots (e.g. a
 * shell script named `.png`). Files are stored OUTSIDE any web root.
 */
interface AllowedType {
  ext: string;
  mimes: string[];
  magic: number[][];
}

const ALLOWED: AllowedType[] = [
  { ext: "png", mimes: ["image/png"], magic: [[0x89, 0x50, 0x4e, 0x47]] },
  { ext: "jpg", mimes: ["image/jpeg"], magic: [[0xff, 0xd8, 0xff]] },
  { ext: "jpeg", mimes: ["image/jpeg"], magic: [[0xff, 0xd8, 0xff]] },
  { ext: "gif", mimes: ["image/gif"], magic: [[0x47, 0x49, 0x46, 0x38]] },
  { ext: "webp", mimes: ["image/webp"], magic: [[0x52, 0x49, 0x46, 0x46]] },
  { ext: "pdf", mimes: ["application/pdf"], magic: [[0x25, 0x50, 0x44, 0x46]] },
];

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : "";
}

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic[i]) return false;
  }
  return true;
}

export function validateUpload(
  filename: string,
  declaredMime: string,
  bytes: Uint8Array,
): { ext: string; mime: string } {
  const ext = extensionOf(filename);
  const allowed = ALLOWED.find((a) => a.ext === ext);
  if (!allowed) {
    throw new PressError("validation", `File type not allowed: .${ext || "unknown"}`);
  }
  if (!allowed.mimes.includes(declaredMime)) {
    throw new PressError("validation", `Content-type "${declaredMime}" does not match .${ext}`);
  }
  if (!allowed.magic.some((magic) => startsWith(bytes, magic))) {
    throw new PressError("validation", `File contents do not match .${ext} (possible disguised file)`);
  }
  return { ext, mime: allowed.mimes[0] as string };
}

export interface MediaRecord extends StoredDoc {
  filename: string;
  mime: string;
  ext: string;
  size: number;
  path: string;
  createdAt: string;
}

export interface MediaServiceOptions {
  storage: StorageAdapter;
  audit: AuditLog;
  /** Directory OUTSIDE the web root where uploaded files are written. */
  mediaRoot: string;
  now?: () => number;
}

export interface MediaService {
  store(filename: string, declaredMime: string, bytes: Uint8Array, actorId: string): Promise<MediaRecord>;
  list(): Promise<MediaRecord[]>;
  get(id: string): Promise<MediaRecord | null>;
  delete(id: string, actorId: string): Promise<void>;
}

export function createMediaService(opts: MediaServiceOptions): MediaService {
  const now = opts.now ?? (() => Date.now());

  async function get(id: string): Promise<MediaRecord | null> {
    const result = await opts.storage.get<MediaRecord>("media", id);
    if (!result.ok) throw result.error;
    return result.value;
  }

  return {
    async store(filename, declaredMime, bytes, actorId) {
      const { ext, mime } = validateUpload(filename, declaredMime, bytes);
      const id = randomUUID();
      await mkdir(opts.mediaRoot, { recursive: true });
      const path = `${opts.mediaRoot}/${id}.${ext}`;
      await writeFile(path, bytes);
      const record: MediaRecord = {
        id,
        filename,
        mime,
        ext,
        size: bytes.byteLength,
        path,
        createdAt: new Date(now()).toISOString(),
      };
      const result = await opts.storage.put("media", record);
      if (!result.ok) throw result.error;
      await opts.audit.append({
        action: "media.upload",
        actorId,
        detail: { mediaId: id, filename, mime, size: record.size },
      });
      return record;
    },

    get,

    async list() {
      const result = await opts.storage.query<MediaRecord>("media", {});
      if (!result.ok) throw result.error;
      return result.value.items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },

    async delete(id, actorId) {
      const record = await get(id);
      if (!record) throw new PressError("not_found", "Media not found");
      // Remove the on-disk blob first; tolerate an already-missing file.
      await rm(record.path, { force: true });
      const result = await opts.storage.delete("media", id);
      if (!result.ok) throw result.error;
      await opts.audit.append({
        action: "media.delete",
        actorId,
        detail: { mediaId: id, filename: record.filename },
      });
    },
  };
}
