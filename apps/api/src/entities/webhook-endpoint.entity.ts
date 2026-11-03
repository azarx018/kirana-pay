import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import type { EndpointStatus } from '../webhooks/webhook.constants';

/** Merchant-registered HTTPS receiver. The signing secret is stored ENCRYPTED (AES-256-GCM). */
@Entity('webhook_endpoints')
export class WebhookEndpoint {
  @PrimaryColumn('uuid', { default: () => 'gen_random_uuid()' })
  id!: string;

  @Index('idx_webhook_endpoints_merchant')
  @Column({ type: 'uuid' })
  merchantId!: string;

  @Column({ type: 'varchar', length: 2048 })
  url!: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  description!: string | null;

  @Column({ type: 'text', array: true })
  events!: string[];

  @Column({ type: 'varchar', length: 12, default: 'ACTIVE' })
  status!: EndpointStatus;

  @Column({ type: 'text', nullable: true })
  secretCiphertext!: string | null;

  @Column({ type: 'varchar', length: 8, nullable: true })
  secretHint!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  secretRotatedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ type: 'uuid', nullable: true })
  createdByUserId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  updatedByUserId!: string | null;
}
