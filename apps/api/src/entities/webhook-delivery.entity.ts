import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';
import type { DeliveryStatus } from '../webhooks/webhook.constants';

/** One row per (event, endpoint). Claimed by workers with FOR UPDATE SKIP LOCKED + lease. */
@Entity('webhook_deliveries')
export class WebhookDelivery {
  @PrimaryColumn('uuid', { default: () => 'gen_random_uuid()' })
  id!: string;

  @Index('idx_webhook_deliveries_event_endpoint', { unique: true })
  @Column({ type: 'uuid' })
  eventRowId!: string;

  @Index('idx_webhook_deliveries_endpoint')
  @Column({ type: 'uuid' })
  endpointId!: string;

  @Column({ type: 'uuid' })
  merchantId!: string;

  @Column({ type: 'varchar', length: 12, default: 'PENDING' })
  status!: DeliveryStatus;

  @Column({ type: 'integer', default: 0 })
  attemptCount!: number;

  @Index('idx_webhook_deliveries_claim')
  @Column({ type: 'timestamptz', default: () => 'now()' })
  nextAttemptAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  lockedUntil!: Date | null;

  @Column({ type: 'boolean', default: false })
  manualRetry!: boolean;

  @Column({ type: 'varchar', length: 24, nullable: true })
  lastResultCategory!: string | null;

  @Column({ type: 'integer', nullable: true })
  lastHttpStatus!: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastAttemptAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
