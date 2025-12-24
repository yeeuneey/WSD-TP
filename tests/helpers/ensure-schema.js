const { Client } = require("pg");
const { env } = require("../../src/config/env");

let client;

const tableExists = async (name) => {
  const result = await client.query(
    `SELECT to_regclass('public."${name}"') AS reg;`,
  );
  return Boolean(result.rows?.[0]?.reg);
};

const columnExists = async (table, column) => {
  const result = await client.query(
    "SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2 LIMIT 1;",
    [table, column],
  );
  return result.rowCount > 0;
};

const indexExists = async (indexName) => {
  const result = await client.query(
    "SELECT 1 FROM pg_indexes WHERE indexname = $1 LIMIT 1;",
    [indexName],
  );
  return result.rowCount > 0;
};

const constraintExists = async (constraintName) => {
  const result = await client.query(
    "SELECT 1 FROM pg_constraint WHERE conname = $1 LIMIT 1;",
    [constraintName],
  );
  return result.rowCount > 0;
};

const ensureTables = async () => {
  if (!(await tableExists("Study"))) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS "Study" (
        "id" SERIAL NOT NULL,
        "title" TEXT NOT NULL,
        "description" TEXT NOT NULL,
        "category" TEXT,
        "maxMembers" INTEGER,
        "status" TEXT NOT NULL DEFAULT 'RECRUITING',
        "leaderId" INTEGER NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "Study_pkey" PRIMARY KEY ("id")
      );
    `);
  }

  if (!(await tableExists("StudyMember"))) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS "StudyMember" (
        "id" SERIAL NOT NULL,
        "studyId" INTEGER NOT NULL,
        "userId" INTEGER NOT NULL,
        "memberRole" TEXT NOT NULL DEFAULT 'MEMBER',
        "status" TEXT NOT NULL DEFAULT 'APPROVED',
        "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "StudyMember_pkey" PRIMARY KEY ("id")
      );
    `);
  }

  if (!(await tableExists("AttendanceSession"))) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS "AttendanceSession" (
        "id" SERIAL NOT NULL,
        "studyId" INTEGER NOT NULL,
        "title" TEXT NOT NULL,
        "date" TIMESTAMP(3) NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "AttendanceSession_pkey" PRIMARY KEY ("id")
      );
    `);
  }

  if (!(await tableExists("AttendanceRecord"))) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS "AttendanceRecord" (
        "id" SERIAL NOT NULL,
        "sessionId" INTEGER NOT NULL,
        "userId" INTEGER NOT NULL,
        "status" TEXT NOT NULL,
        "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("id")
      );
    `);
  }
};

const ensureUserColumns = async () => {
  if (!(await columnExists("User", "provider"))) {
    await client.query(
      `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "provider" TEXT NOT NULL DEFAULT 'LOCAL';`,
    );
  }

  if (!(await columnExists("User", "providerId"))) {
    await client.query(
      `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "providerId" TEXT;`,
    );
  }
};

const ensureIndexesAndConstraints = async () => {
  if (!(await indexExists("User_email_key"))) {
    await client.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");`,
    );
  }

  if (!(await indexExists("User_providerId_key"))) {
    await client.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "User_providerId_key" ON "User"("providerId");`,
    );
  }

  if (!(await indexExists("StudyMember_studyId_userId_key"))) {
    await client.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "StudyMember_studyId_userId_key" ON "StudyMember"("studyId", "userId");`,
    );
  }

  if (!(await constraintExists("Study_leaderId_fkey"))) {
    await client.query(`
      ALTER TABLE "Study"
      ADD CONSTRAINT "Study_leaderId_fkey"
      FOREIGN KEY ("leaderId") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
    `);
  }

  if (!(await constraintExists("StudyMember_studyId_fkey"))) {
    await client.query(`
      ALTER TABLE "StudyMember"
      ADD CONSTRAINT "StudyMember_studyId_fkey"
      FOREIGN KEY ("studyId") REFERENCES "Study"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
    `);
  }

  if (!(await constraintExists("StudyMember_userId_fkey"))) {
    await client.query(`
      ALTER TABLE "StudyMember"
      ADD CONSTRAINT "StudyMember_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
    `);
  }

  if (!(await constraintExists("AttendanceSession_studyId_fkey"))) {
    await client.query(`
      ALTER TABLE "AttendanceSession"
      ADD CONSTRAINT "AttendanceSession_studyId_fkey"
      FOREIGN KEY ("studyId") REFERENCES "Study"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
    `);
  }

  if (!(await constraintExists("AttendanceRecord_sessionId_fkey"))) {
    await client.query(`
      ALTER TABLE "AttendanceRecord"
      ADD CONSTRAINT "AttendanceRecord_sessionId_fkey"
      FOREIGN KEY ("sessionId") REFERENCES "AttendanceSession"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
    `);
  }

  if (!(await constraintExists("AttendanceRecord_userId_fkey"))) {
    await client.query(`
      ALTER TABLE "AttendanceRecord"
      ADD CONSTRAINT "AttendanceRecord_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
    `);
  }
};

const ensureSchema = async () => {
  const clientInstance = new Client({ connectionString: env.DATABASE_URL });
  client = clientInstance;
  try {
    await client.connect();
    await ensureTables();
    await ensureUserColumns();
    await ensureIndexesAndConstraints();
  } catch (error) {
    console.error("ensureSchema failed", error);
    throw error;
  } finally {
    await client.end();
    client = null;
  }
};

module.exports = { ensureSchema };
