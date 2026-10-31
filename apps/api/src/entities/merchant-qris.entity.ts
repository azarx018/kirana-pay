import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export type QrisStatus = 'ACTIVE' | 'ARCHIVED';

/** One static QRIS owned by a merchant, tied to exactly one provider. */
@Entity('merchant_qris')
export class MerchantQris {
  @PrimaryColumn('uuid', { default: () => 'gen_random_uuid()' })
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  merchantId!: string;

  @Index()
  @Column({ type: 'uuid' })
  providerId!: string;

  /** Merchant-chosen label; never a substitute for provider identity. */
  @Column({ type: 'varchar', length: 80 })
  displayName!: string;

  @Column({ type: 'varchar', length: 255 })
  imagePath!: string;

  @Column({ type: 'varchar', length: 64 })
  imageSha256!: string;

  @Column({ type: 'varchar', length: 16, default: 'ACTIVE' })
  status!: QrisStatus;

  /** Facts read from the payload at upload time (informational only). */
  @Column({ type: 'varchar', length: 32, nullable: true })
  nmid!: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  merchantName!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
