import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

export type IdempotencyState = 'IN_PROGRESS' | 'COMPLETED';

/** Documents the `idempotency_records` schema; queries use raw SQL (see idempotency.service.ts). */
@Entity('idempotency_records')
export class IdempotencyRecord {
  @PrimaryColumn('uuid', { default: () => 'gen_random_uuid()' })
  id!: string;

  @Column({ type: 'uuid' })
  merchantId!: string;

  @Column({ type: 'varchar', length: 40 })
  operation!: string;

  @Column({ type: 'char', length: 64 })
  keyHash!: string;

  @Column({ type: 'char', length: 64 })
  fingerprint!: string;

  @Column({ type: 'varchar', length: 12, default: 'IN_PROGRESS' })
  state!: IdempotencyState;

  @Column({ type: 'uuid', nullable: true })
  invoiceId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;
}
