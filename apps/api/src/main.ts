import { ValidationPipe, Logger } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'node:path';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });

  app.use(cookieParser());

  // Dashboard (static, no build step) served by the API itself.
  app.useStaticAssets(join(__dirname, '..', 'public'), { index: 'index.html' });
  const logger = new Logger('Bootstrap');

  app.setGlobalPrefix('');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Kirana Pay API')
    .setDescription('Static QRIS to amount-specific QR checkout (MVP 0.1)')
    .setVersion('0.1.0')
    .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'x-api-key')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swaggerConfig));

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');

  if (!process.env.API_KEY) {
    logger.warn('API_KEY is not set: the API is running WITHOUT authentication. Development only.');
  }
  logger.log(`Kirana Pay API listening on :${port}`);
}

void bootstrap();
