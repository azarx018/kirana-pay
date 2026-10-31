import { Injectable } from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { FileStorage } from './storage.interface';

@Injectable()
export class LocalFileStorage implements FileStorage {
  private readonly rootDir = process.env.STORAGE_LOCAL_DIR ?? './var/qr';

  async save(key: string, data: Buffer): Promise<string> {
    const path = join(this.rootDir, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
    return path;
  }

  async read(path: string): Promise<Buffer> {
    return readFile(path);
  }
}
