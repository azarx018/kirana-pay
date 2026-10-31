export const FILE_STORAGE = Symbol('FILE_STORAGE');

/** Storage abstraction so local dev can be swapped for object storage later. */
export interface FileStorage {
  save(key: string, data: Buffer, contentType: string): Promise<string>;
  read(path: string): Promise<Buffer>;
}
