import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export type InvoiceStatus = 'PENDING' | 'PAID' | 'EXPIRED';

/**
 * Merchant-scoped invoice. A created invoice or a generated QR is NOT a payment:
 * only `status = PAID` means a merchant user explicitly confirmed receipt.
 */
@Entity('invoices')
export class Invoice {
  @PrimaryColumn('uuid', { default: () => 'gen_random_uuid()' })
  id!: string;

  /** Non-guessable public identifier used in URLs. */
  @Index('idx_invoices_public_id', { unique: true })
  @Column({ type: 'varchar', length: 32 })
  publicId!: string;

  @Index('idx_invoices_merchant')
  @Column({ type: 'uuid' })
  merchantId!: string;

  /** Historical reference: QRIS rows are archived, never deleted. */
  @Index('idx_invoices_qris')
  @Column({ type: 'uuid' })
  qrisId!: string;

  /** Integer rupiah, stored as bigint (never floating point). */
  @Column({ type: 'bigint' })
  amount!: string;

  @Column({ type: 'varchar', length: 8, default: 'IDR' })
  currency!: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  description!: string | null;

  @Index('idx_invoices_status')
  @Column({ type: 'varchar', length: 16, default: 'PENDING' })
  status!: InvoiceStatus;

  @Column({ type: 'varchar', length: 255, nullable: true })
  qrPath!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  qrSha256!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @Index('idx_invoices_expires_at')
  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  paidAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  confirmedByUserId!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  confirmationMethod!: string | null;
}
