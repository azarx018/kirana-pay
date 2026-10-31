import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

/** Central registry of payment providers. Seeded by migration, never hard-coded elsewhere. */
@Entity('payment_providers')
export class PaymentProvider {
  @PrimaryColumn('uuid', { default: () => 'gen_random_uuid()' })
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 40 })
  code!: string;

  @Column({ type: 'varchar', length: 80 })
  name!: string;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
