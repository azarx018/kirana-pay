import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

export type MemberRole = 'OWNER' | 'STAFF';

@Entity('merchant_members')
@Index(['merchantId', 'userId'], { unique: true })
export class MerchantMember {
  @PrimaryColumn('uuid', { default: () => 'gen_random_uuid()' })
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  merchantId!: string;

  @Index()
  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', length: 16, default: 'OWNER' })
  role!: MemberRole;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
