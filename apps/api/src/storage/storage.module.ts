import { Global, Module } from '@nestjs/common';
import { FILE_STORAGE } from './storage.interface';
import { LocalFileStorage } from './local-storage.service';

@Global()
@Module({
  providers: [{ provide: FILE_STORAGE, useClass: LocalFileStorage }],
  exports: [FILE_STORAGE],
})
export class StorageModule {}
