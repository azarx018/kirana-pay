import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('api_keys')
export class ApiKey {
  @PrimaryColumn('uuid', { default: () => 'gen_random_uuid()' })
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  merchantId!: string;

  @Column({ type: 'varchar', length: 60 })
  name!: string;

  /** First characters, shown in the UI so a key can be identified. */
  @Column({ type: 'varchar', length: 16 })
  prefix!: string;

  /** SHA-256 of the secret; the plaintext key is returned only once. */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  keyHash!: string;

  @Column({ type: 'timestamptz', nullable: true })
  lastUsedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
