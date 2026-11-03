import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Transactional OUTBOX. One row per business event, written inside the same transaction as the
 * invoice change, so an event exists if and only if the change committed.
 * `payloadJson` is the exact byte string sent on every attempt (retries never re-serialise).
 */
@Entity('webhook_events')
export class WebhookEvent {
  @PrimaryColumn('uuid', { default: () => 'gen_random_uuid()' })
  id!: string;

  @Index('idx_webhook_events_event_id', { unique: true })
  @Column({ type: 'varchar', length: 40 })
  eventId!: string;

  @Column({ type: 'uuid' })
  merchantId!: string;

  @Column({ type: 'varchar', length: 40 })
  type!: string;

  @Column({ type: 'uuid' })
  invoiceId!: string;

  @Column({ type: 'text' })
  payloadJson!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'varchar', length: 8, default: 'PENDING' })
  fanoutStatus!: 'PENDING' | 'DONE';

  @Column({ type: 'timestamptz', nullable: true })
  fanoutLockedUntil!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  fanoutDoneAt!: Date | null;
}
