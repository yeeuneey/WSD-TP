// prisma.config.ts
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  // Prisma가 사용할 schema 파일 위치
  schema: 'prisma/schema.prisma',

  // 마이그레이션 폴더 위치
  migrations: {
    path: 'prisma/migrations',
  },

  // 여기서 DATABASE_URL을 읽어온다
  datasource: {
    url: env('DATABASE_URL'),
  },
});