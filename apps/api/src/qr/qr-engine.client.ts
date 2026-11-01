import { Injectable, Logger } from '@nestjs/common';

export interface EngineConvertResult {
  payload: string;
  qrPngBase64: string;
  meta: {
    nmid: string;
    merchantName: string;
    currency: string;
    country: string;
    amount: number;
    isDynamic: boolean;
  };
}

export interface EngineInspectResult {
  meta: {
    nmid: string;
    merchantName: string;
    currency: string;
    country: string;
    isDynamic: boolean;
    hasAmount: boolean;
  };
}

export class QrEngineError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Internal HTTP client for the Rust QR engine. Never exposed to the internet. */
@Injectable()
export class QrEngineClient {
  private readonly logger = new Logger(QrEngineClient.name);
  private readonly baseUrl = process.env.QR_ENGINE_URL ?? 'http://127.0.0.1:8081';
  private readonly timeoutMs = Number(process.env.QR_ENGINE_TIMEOUT_MS ?? 5000);

  async inspect(imageBase64: string): Promise<EngineInspectResult['meta']> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/internal/qr/inspect`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ imageBase64 }),
        signal: controller.signal,
      });
      const body = (await response.json()) as
        | EngineInspectResult
        | { success: false; error: { code: string; message: string } };
      if (!response.ok || 'error' in body) {
        const err = 'error' in body ? body.error : { code: 'QR_ENGINE_UNAVAILABLE', message: 'inspect failed' };
        throw new QrEngineError(err.code, err.message);
      }
      return body.meta;
    } catch (error) {
      if (error instanceof QrEngineError) throw error;
      this.logger.error(`QR engine inspect failed: ${(error as Error).message}`);
      throw new QrEngineError('QR_ENGINE_UNAVAILABLE', 'QR engine is unavailable.');
    } finally {
      clearTimeout(timer);
    }
  }

  async convert(imageBase64: string, amount: number, note?: string): Promise<EngineConvertResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/internal/qr/convert`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ imageBase64, amount, note: note ?? null }),
        signal: controller.signal,
      });

      const body = (await response.json()) as
        | ({ success?: boolean; error?: { code?: string; message?: string } } & EngineConvertResult)
        | { success: false; error: { code: string; message: string } };

      // Only an explicit `success: false` envelope is an engine error; a result is never flagged by key presence.
      if (!response.ok || (body as { success?: boolean }).success === false) {
        const err = (body as { error?: { code?: string; message?: string } }).error;
        throw new QrEngineError(err?.code ?? 'QR_ENGINE_UNAVAILABLE', err?.message ?? 'QR engine error');
      }

      return body as EngineConvertResult;
    } catch (error) {
      if (error instanceof QrEngineError) {
        throw error;
      }
      this.logger.error(`QR engine call failed: ${(error as Error).message}`);
      throw new QrEngineError('QR_ENGINE_UNAVAILABLE', 'QR engine is unavailable.');
    } finally {
      clearTimeout(timer);
    }
  }
}
