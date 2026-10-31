import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { HealthController } from './health.controller';
import { QrModule } from './qr/qr.module';
import { QrJob } from './qr/qr-job.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        host: config.get<string>('DB_HOST', '127.0.0.1'),
        port: Number(config.get<string>('DB_PORT', '5432')),
        username: config.get<string>('DB_USER', 'kirana'),
        password: config.get<string>('DB_PASSWORD', 'kirana'),
        database: config.get<string>('DB_NAME', 'kirana_pay'),
        entities: [QrJob],
        synchronize: config.get<string>('DB_SYNCHRONIZE', 'true') === 'true',
      }),
    }),
    QrModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
