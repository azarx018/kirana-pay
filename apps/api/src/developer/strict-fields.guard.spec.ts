import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateInvoiceDto } from '../invoices/dto/invoice.dto';
import { INVOICE_CREATE_FIELDS, LIST_QUERY_FIELDS } from './developer-invoices.controller';
import { StrictFields, StrictFieldsGuard } from './strict-fields.guard';

class Sample {
  @StrictFields({ body: ['amount', 'qrisId'] })
  create(): void {}
  @StrictFields({ query: ['limit'] })
  list(): void {}
  open(): void {}
}

const guard = new StrictFieldsGuard(new Reflector());
const ctx = (handler: () => void, req: Record<string, unknown>) =>
  ({ getHandler: () => handler, switchToHttp: () => ({ getRequest: () => req }) }) as unknown as ExecutionContext;

describe('StrictFieldsGuard', () => {
  it('accepts exactly the declared body fields', () => {
    expect(guard.canActivate(ctx(Sample.prototype.create, { body: { amount: 1, qrisId: 'x' } }))).toBe(true);
    expect(guard.canActivate(ctx(Sample.prototype.create, { body: { amount: 1 } }))).toBe(true);
  });

  it.each(['status', 'paidAt', 'merchantId', 'confirmedBy', '__proto__x'])('rejects unknown body field %s (400)', (field) => {
    try {
      guard.canActivate(ctx(Sample.prototype.create, { body: { amount: 1, [field]: 'PAID' } }));
      throw new Error('should have thrown');
    } catch (e) {
      const err = e as { getStatus(): number; response: { code: string; message: string } };
      expect(err.getStatus()).toBe(400);
      expect(err.response.code).toBe('BAD_REQUEST');
      expect(err.response.message).toContain(field);
    }
  });

  it('rejects non-object bodies', () => {
    for (const body of [[], 'x', 42, null]) {
      expect(() => guard.canActivate(ctx(Sample.prototype.create, { body }))).toThrow(/JSON object/);
    }
  });

  it('lets a missing body through to DTO validation', () => {
    expect(guard.canActivate(ctx(Sample.prototype.create, {}))).toBe(true);
  });

  it('rejects unknown query parameters', () => {
    expect(guard.canActivate(ctx(Sample.prototype.list, { query: { limit: '2' } }))).toBe(true);
    expect(() => guard.canActivate(ctx(Sample.prototype.list, { query: { limit: '2', merchantId: 'x' } }))).toThrow(
      /Unknown query parameter: merchantId/,
    );
  });

  it('truncates long hostile field names in the error', () => {
    try {
      guard.canActivate(ctx(Sample.prototype.create, { body: { ['x'.repeat(500)]: 1 } }));
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as { response: { message: string } }).response.message.length).toBeLessThan(200);
    }
  });

  it('is a no-op on routes without a declaration', () => {
    expect(guard.canActivate(ctx(Sample.prototype.open, { body: { anything: 1 } }))).toBe(true);
  });
});

describe('Developer API field lists stay in sync with the DTOs', () => {
  it('every allowed invoice field is a real, accepted CreateInvoiceDto property', async () => {
    const dto = plainToInstance(CreateInvoiceDto, {
      amount: 1000,
      description: 'x',
      qrisId: '3f2c1b0a-1111-4222-8333-444455556666',
      expiresInMinutes: 30,
    });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors).toEqual([]);
    expect([...INVOICE_CREATE_FIELDS].sort()).toEqual(['amount', 'description', 'expiresInMinutes', 'qrisId']);
  });

  it('list query fields are the documented ones', () => {
    expect([...LIST_QUERY_FIELDS].sort()).toEqual(['createdAfter', 'createdBefore', 'cursor', 'limit', 'status']);
  });
});
