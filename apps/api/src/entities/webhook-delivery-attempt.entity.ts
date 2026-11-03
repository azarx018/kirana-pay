import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** Bounded history (30 days). Removed together with its delivery by the retention job. */
@Entity('webhook_delivery_attempts')
export class WebhookDeliveryAttempt {
  @PrimaryColumn('uuid', { default: () => 'gen_random_uuid()' })
  id!: string;

  @Index('idx_webhook_attempts_delivery', { unique: true })
  @Column({ type: 'uuid' })
  deliveryId!: string;

  @Column({ type: 'integer' })
  attemptNumber!: number;

  @Column({ type: 'varchar', length: 8, default: 'AUTO' })
  trigger!: 'AUTO' | 'MANUAL';

  @Column({ type: 'timestamptz' })
  startedAt!: Date;

  @Column({ type: 'integer' })
  durationMs!: number;

  @Column({ type: 'varchar', length: 24 })
  resultCategory!: string;

  @Column({ type: 'integer', nullable: true })
  httpStatus!: number | null;

  @Column({ type: 'varchar', length: 256, nullable: true })
  responseExcerpt!: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  errorCode!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  retryAt!: Date | null;
}
