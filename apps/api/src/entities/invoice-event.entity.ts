import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

export type InvoiceEventType = 'CREATED' | 'PAYMENT_CONFIRMED' | 'EXPIRED';

/** Append-only audit trail for invoices (who did what, when). */
@Entity('invoice_events')
export class InvoiceEvent {
  @PrimaryColumn('uuid', { default: () => 'gen_random_uuid()' })
  id!: string;

  @Index('idx_invoice_events_invoice')
  @Column({ type: 'uuid' })
  invoiceId!: string;

  @Column({ type: 'varchar', length: 32 })
  type!: InvoiceEventType;

  /** Null for system-driven events (expiration) and API-key driven creation. */
  @Column({ type: 'uuid', nullable: true })
  actorUserId!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
