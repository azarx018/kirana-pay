import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

/** Who changed what. Host names only — never URLs with query strings, never secrets. */
@Entity('webhook_endpoint_audit')
export class WebhookEndpointAudit {
  @PrimaryColumn('uuid', { default: () => 'gen_random_uuid()' })
  id!: string;

  @Index('idx_webhook_audit_endpoint')
  @Column({ type: 'uuid' })
  endpointId!: string;

  @Column({ type: 'uuid' })
  merchantId!: string;

  @Column({ type: 'varchar', length: 24 })
  action!: string;

  @Column({ type: 'uuid', nullable: true })
  actorUserId!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
