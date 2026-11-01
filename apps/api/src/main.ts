import './env';
import { ValidationPipe, Logger } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'node:path';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { assertProductionConfig, isSwaggerEnabled, parseTrustProxy } from './common/runtime-config';
import { securityHeaders } from './common/security-headers.middleware';

async function bootstrap(): Promise<void> {
  assertProductionConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });

  app.disable('x-powered-by');
  // Behind Funnel / Next rewrite / Caddy: set TRUST_PROXY (hop count) so rate limits are per client.
  app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY));
  app.use(securityHeaders);
  app.use(cookieParser());

  // Dashboard (static, no build step) served by the API itself.
  app.useStaticAssets(join(__dirname, '..', 'public'), { index: 'index.html' });
  const logger = new Logger('Bootstrap');

  app.setGlobalPrefix('');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  // Swagger lists the whole API surface: opt-in in production (ENABLE_SWAGGER=true).
  if (isSwaggerEnabled()) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Kirana Pay API')
      .setDescription('Static QRIS to amount-specific QR checkout (MVP 0.1)')
      .setVersion('0.1.0')
      .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'x-api-key')
      .build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swaggerConfig));
  }

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');

  logger.log(`Kirana Pay API listening on :${port}`);
}

void bootstrap();
