const request = require("supertest");
const app = require("../../src/app").default;
const { prisma } = require("../../src/config/db");
const { redis, ensureRedisConnection } = require("../../src/config/redis");
const { ensureSchema } = require("../helpers/ensure-schema");

const clearDatabase = async () => {
  await prisma.attendanceRecord.deleteMany();
  await prisma.attendanceSession.deleteMany();
  await prisma.studyMember.deleteMany();
  await prisma.study.deleteMany();
  await prisma.user.deleteMany();
};

const register = async (overrides = {}) => {
  const payload = {
    email: `user-${Date.now()}-${Math.random()}@example.com`,
    password: "Password123!",
    name: "Test User",
    ...overrides,
  };

  const response = await request(app).post("/auth/register").send(payload);
  return response.body;
};

describe("Study and Attendance flows", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await ensureSchema();
    await ensureRedisConnection();
  });

  beforeEach(async () => {
    await clearDatabase();
    await redis.flushDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await redis.quit();
  });

  it("creates a study, joins, creates session, records attendance, and gets summary", async () => {
    const leader = await register({
      email: `leader-${Date.now()}@example.com`,
      name: "Leader",
    });
    const member = await register({
      email: `member-${Date.now()}@example.com`,
      name: "Member",
    });

    const studyResponse = await request(app)
      .post("/studies")
      .set("Authorization", `Bearer ${leader.accessToken}`)
      .send({
        title: "Backend Study",
        description: "Deep dive into APIs",
        category: "BACKEND",
        maxMembers: 10,
      });

    expect(studyResponse.status).toBe(201);
    const studyId = studyResponse.body.study.id;

    const joinResponse = await request(app)
      .post(`/studies/${studyId}/join`)
      .set("Authorization", `Bearer ${member.accessToken}`);

    expect(joinResponse.status).toBe(201);

    const sessionResponse = await request(app)
      .post(`/studies/${studyId}/sessions`)
      .set("Authorization", `Bearer ${leader.accessToken}`)
      .send({
        title: "Week 1",
        date: new Date().toISOString(),
      });

    expect(sessionResponse.status).toBe(201);
    const sessionId = sessionResponse.body.session.id;

    const attendanceResponse = await request(app)
      .post(`/studies/${studyId}/sessions/${sessionId}/attendance`)
      .set("Authorization", `Bearer ${member.accessToken}`)
      .send({ status: "PRESENT" });

    expect(attendanceResponse.status).toBe(201);
    expect(attendanceResponse.body.record.status).toBe("PRESENT");

    const summaryResponse = await request(app)
      .get(`/studies/${studyId}/attendance/summary`)
      .set("Authorization", `Bearer ${leader.accessToken}`);

    expect(summaryResponse.status).toBe(200);
    expect(summaryResponse.body.summary.total).toBeGreaterThan(0);
  });
});
