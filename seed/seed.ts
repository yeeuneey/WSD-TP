import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../src/config/db";
import { hashPassword } from "../src/utils/passwords";

const USER_COUNT = 20;
const STUDY_COUNT = 10;
const SESSIONS_PER_STUDY = 3;
const RANDOM_SEED = 42;
const BASE_DATE = new Date("2024-01-15T00:00:00.000Z");

type PrismaClientLike = PrismaClient | Prisma.TransactionClient;

const createRandom = (seed: number) => {
  // Deterministic PRNG (Mulberry32)
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const random = createRandom(RANDOM_SEED);

const randomFrom = <T>(items: T[]): T =>
  items[Math.floor(random() * items.length)];

const STUDY_TITLES = [
  "TypeScript Mastery",
  "Backend Bootcamp",
  "Frontend Craft",
  "Cloud Builders",
  "System Design Lab",
  "AI Study Group",
  "Algorithm Arena",
  "Product Builders",
  "Database Deep Dive",
  "DevOps Journey",
];

const CATEGORIES = ["WEB", "MOBILE", "AI", "BACKEND", "FRONTEND"];
const STATUSES = ["PRESENT", "LATE", "ABSENT"] as const;

const clearDatabase = async (client: PrismaClientLike) => {
  await client.attendanceRecord.deleteMany();
  await client.attendanceSession.deleteMany();
  await client.studyMember.deleteMany();
  await client.study.deleteMany();
  await client.user.deleteMany();
};

const seedUsers = async (client: PrismaClientLike) => {
  const passwordHash = await hashPassword("Password123!");

  const usersData = Array.from({ length: USER_COUNT }, (_, index) => ({
    email: `user${index + 1}@example.com`,
    passwordHash,
    name: `User ${index + 1}`,
    role: index === 0 ? "ADMIN" : "USER",
  }));

  await client.user.createMany({ data: usersData, skipDuplicates: true });
  return client.user.findMany({ orderBy: { id: "asc" } });
};

const seedStudies = async (client: PrismaClientLike, userIds: number[]) => {
  const studies = await Promise.all(
    Array.from({ length: STUDY_COUNT }, (_, index) => {
      const leaderId = userIds[index % userIds.length];
      return client.study.create({
        data: {
          title: STUDY_TITLES[index % STUDY_TITLES.length],
          description: `Study ${index + 1} for building skills together.`,
          category: randomFrom(CATEGORIES),
          maxMembers: 30,
          leaderId,
        },
      });
    }),
  );

  const memberships = studies.flatMap((study) =>
    userIds.map((userId) => ({
      studyId: study.id,
      userId,
      memberRole: userId === study.leaderId ? "LEADER" : "MEMBER",
      status: "APPROVED",
    })),
  );

  await client.studyMember.createMany({
    data: memberships,
    skipDuplicates: true,
  });

  return studies;
};

const seedSessionsAndAttendance = async (
  client: PrismaClientLike,
  studies: { id: number }[],
  userIds: number[],
) => {
  for (const study of studies) {
    const sessions = await Promise.all(
      Array.from({ length: SESSIONS_PER_STUDY }, (_, idx) =>
        client.attendanceSession.create({
          data: {
            studyId: study.id,
            title: `Session ${idx + 1}`,
            date: new Date(
              BASE_DATE.getTime() - idx * 24 * 60 * 60 * 1000,
            ),
          },
        }),
      ),
    );

    for (const session of sessions) {
      const attendanceRecords = userIds.map((userId) => ({
        sessionId: session.id,
        userId,
        status: randomFrom([...STATUSES]),
      }));
      await client.attendanceRecord.createMany({
        data: attendanceRecords,
        skipDuplicates: true,
      });
    }
  }
};

const main = async () => {
  await prisma.$transaction(async (tx) => {
    await clearDatabase(tx);

    const users = await seedUsers(tx);
    const userIds = users.map((user) => user.id);

    const studies = await seedStudies(tx, userIds);
    await seedSessionsAndAttendance(tx, studies, userIds);

    console.log(
      `Seeded ${users.length} users, ${studies.length} studies, ` +
        `${USER_COUNT * STUDY_COUNT} study members, ` +
        `${STUDY_COUNT * SESSIONS_PER_STUDY * USER_COUNT} attendance records.`,
    );
  });
};

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
