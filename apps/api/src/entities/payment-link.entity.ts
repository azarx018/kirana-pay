import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

export type PaymentLinkStatus = 'ACTIVE' | 'REVOKED';

/**
 * MVP V3: a public, revocable handle for ONE existing invoice.
 * The raw token is never stored: it is derived from `tokenNonce` + a server secret
 * (see payment-link.token.ts). Queries use raw SQL; this class documents the schema.
 */
@Entity('payment_links')
export class PaymentLink {
  @PrimaryColumn('uuid', { default: () => 'gen_random_uuid()' })
  id!: string;

  @Column({ type: 'uuid' })
  invoiceId!: string;

  @Column({ type: 'varchar', length: 22, unique: true })
  tokenNonce!: string;

  @Column({ type: 'varchar', length: 16, default: 'ACTIVE' })
  status!: PaymentLinkStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'uuid', nullable: true })
  createdByUserId!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  revokedByUserId!: string | null;
}
