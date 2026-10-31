import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Processing metadata only. No raw QR payload and no payer data are stored.
 */
@Entity('qr_jobs')
export class QrJob {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 32 })
  status!: string;

  @Column({ type: 'bigint' })
  amount!: string;

  @Column({ type: 'varchar', length: 8, default: 'IDR' })
  currency!: string;

  @Index()
  @Column({ type: 'varchar', length: 32 })
  nmid!: string;

  @Column({ type: 'varchar', length: 64 })
  merchantName!: string;

  /** SHA-256 of the generated payload: lets us spot duplicates without storing it. */
  @Column({ type: 'varchar', length: 64 })
  payloadSha256!: string;

  @Column({ type: 'varchar', length: 255 })
  qrPath!: string;

  /** Owning merchant. Nullable only for rows created before multi-tenancy. */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  merchantId!: string | null;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  qrisId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
