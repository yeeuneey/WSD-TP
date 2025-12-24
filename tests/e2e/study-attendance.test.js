const request = require("supertest");
const app = require("../../src/app").default;
const { prisma } = require("../../src/config/db");
const { redis, ensureRedisConnection } = require("../../src/config/redis");
const { ensureSchema } = require("../helpers/ensure-schema");

const resetState = async () => {
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

const approveMember = async ({ studyId, userId, token }) => {
  return request(app)
    .patch(`/studies/${studyId}/members/${userId}/status`)
    .set("Authorization", `Bearer ${token}`)
    .send({ status: "APPROVED" });
};

describe("Study and Attendance flows", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await ensureSchema();
    await ensureRedisConnection();
  });

  beforeEach(async () => {
    await resetState();
    await redis.flushDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await redis.quit();
  });

  it("creates a study, approves members, records attendance, and retrieves summaries", async () => {
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
    expect(joinResponse.body.membership.status).toBe("PENDING");

    const approvalResponse = await approveMember({
      studyId,
      userId: member.user.id,
      token: leader.accessToken,
    });
    expect(approvalResponse.status).toBe(200);
    expect(approvalResponse.body.membership.status).toBe("APPROVED");

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

    const sessionList = await request(app)
      .get(`/studies/${studyId}/sessions`)
      .set("Authorization", `Bearer ${member.accessToken}`);
    expect(sessionList.status).toBe(200);
    expect(sessionList.body.sessions.length).toBeGreaterThan(0);

    const attendanceList = await request(app)
      .get(`/studies/${studyId}/sessions/${sessionId}/attendance`)
      .set("Authorization", `Bearer ${leader.accessToken}`);
    expect(attendanceList.status).toBe(200);
    expect(attendanceList.body.records.length).toBeGreaterThan(0);

    const summaryResponse = await request(app)
      .get(`/studies/${studyId}/attendance/summary`)
      .set("Authorization", `Bearer ${leader.accessToken}`);

    expect(summaryResponse.status).toBe(200);
    expect(summaryResponse.body.summary.total).toBeGreaterThan(0);

    const memberSummary = await request(app)
      .get(`/studies/${studyId}/attendance/users/${member.user.id}`)
      .set("Authorization", `Bearer ${leader.accessToken}`);
    expect(memberSummary.status).toBe(200);
    expect(memberSummary.body.summary.total).toBeGreaterThan(0);
  });

  it("blocks non-leader session creation and invalid payloads", async () => {
    const leader = await register({ email: `l-${Date.now()}@ex.com` });
    const member = await register({ email: `m-${Date.now()}@ex.com` });

    const { body: studyBody } = await request(app)
      .post("/studies")
      .set("Authorization", `Bearer ${leader.accessToken}`)
      .send({ title: "Rules", description: "Rules study" });
    const studyId = studyBody.study.id;

    await request(app)
      .post(`/studies/${studyId}/join`)
      .set("Authorization", `Bearer ${member.accessToken}`);
    await approveMember({
      studyId,
      userId: member.user.id,
      token: leader.accessToken,
    });

    const forbidden = await request(app)
      .post(`/studies/${studyId}/sessions`)
      .set("Authorization", `Bearer ${member.accessToken}`)
      .send({ title: "Week", date: new Date().toISOString() });
    expect(forbidden.status).toBe(403);

    const invalidDate = await request(app)
      .post(`/studies/${studyId}/sessions`)
      .set("Authorization", `Bearer ${leader.accessToken}`)
      .send({ title: "Bad", date: "not-a-date" });
    expect(invalidDate.status).toBe(400);
  });

  it("blocks attendance actions until membership is approved", async () => {
    const leader = await register({ email: `pending-${Date.now()}@ex.com` });
    const member = await register({ email: `pend-${Date.now()}@ex.com` });

    const { body: studyBody } = await request(app)
      .post("/studies")
      .set("Authorization", `Bearer ${leader.accessToken}`)
      .send({ title: "Pending", description: "Pending flow" });
    const studyId = studyBody.study.id;

    await request(app)
      .post(`/studies/${studyId}/join`)
      .set("Authorization", `Bearer ${member.accessToken}`);

    // Pending member cannot list sessions or record attendance
    const sessionList = await request(app)
      .get(`/studies/${studyId}/sessions`)
      .set("Authorization", `Bearer ${member.accessToken}`);
    expect(sessionList.status).toBe(403);

    const session = await request(app)
      .post(`/studies/${studyId}/sessions`)
      .set("Authorization", `Bearer ${leader.accessToken}`)
      .send({ title: "Week 0", date: new Date().toISOString() });

    const attendanceAttempt = await request(app)
      .post(`/studies/${studyId}/sessions/${session.body.session.id}/attendance`)
      .set("Authorization", `Bearer ${member.accessToken}`)
      .send({ status: "PRESENT" });
    expect(attendanceAttempt.status).toBe(403);

    // After approval, actions succeed
    await approveMember({
      studyId,
      userId: member.user.id,
      token: leader.accessToken,
    });

    const sessionListAfter = await request(app)
      .get(`/studies/${studyId}/sessions`)
      .set("Authorization", `Bearer ${member.accessToken}`);
    expect(sessionListAfter.status).toBe(200);

    const attendanceAfter = await request(app)
      .post(`/studies/${studyId}/sessions/${session.body.session.id}/attendance`)
      .set("Authorization", `Bearer ${member.accessToken}`)
      .send({ status: "PRESENT" });
    expect(attendanceAfter.status).toBe(201);
  });

  it("enforces capacity and duplicate joins, and rejects invalid attendance status", async () => {
    const leader = await register({ email: `l2-${Date.now()}@ex.com` });
    const member = await register({ email: `m2-${Date.now()}@ex.com` });

    const { body: studyBody } = await request(app)
      .post("/studies")
      .set("Authorization", `Bearer ${leader.accessToken}`)
      // maxMembers includes leader; allow one more approved member
      .send({ title: "Cap", description: "Capacity", maxMembers: 2 });
    const studyId = studyBody.study.id;

    const firstJoin = await request(app)
      .post(`/studies/${studyId}/join`)
      .set("Authorization", `Bearer ${member.accessToken}`);
    expect(firstJoin.status).toBe(201);

    const dupJoin = await request(app)
      .post(`/studies/${studyId}/join`)
      .set("Authorization", `Bearer ${member.accessToken}`);
    expect(dupJoin.status).toBe(409);

    const otherUser = await register({ email: `m3-${Date.now()}@ex.com` });
    const fullJoin = await request(app)
      .post(`/studies/${studyId}/join`)
      .set("Authorization", `Bearer ${otherUser.accessToken}`);
    // join is allowed as pending, capacity enforced at approval time
    expect(fullJoin.status).toBe(201);

    await approveMember({
      studyId,
      userId: member.user.id,
      token: leader.accessToken,
    });

    const approveOther = await approveMember({
      studyId,
      userId: otherUser.user.id,
      token: leader.accessToken,
    });
    expect(approveOther.status).toBe(409);

    const session = await request(app)
      .post(`/studies/${studyId}/sessions`)
      .set("Authorization", `Bearer ${leader.accessToken}`)
      .send({ title: "Week 1", date: new Date().toISOString() });

    const badStatus = await request(app)
      .post(`/studies/${studyId}/sessions/${session.body.session.id}/attendance`)
      .set("Authorization", `Bearer ${member.accessToken}`)
      .send({ status: "UNKNOWN" });
    expect(badStatus.status).toBe(400);
  });

  it("prevents non-leaders from viewing leader-only summary and attendance listing", async () => {
    const leader = await register({ email: `l4-${Date.now()}@ex.com` });
    const member = await register({ email: `m4-${Date.now()}@ex.com` });

    const { body: studyBody } = await request(app)
      .post("/studies")
      .set("Authorization", `Bearer ${leader.accessToken}`)
      .send({ title: "Roles", description: "Role study" });
    const studyId = studyBody.study.id;

    await request(app)
      .post(`/studies/${studyId}/join`)
      .set("Authorization", `Bearer ${member.accessToken}`);
    await approveMember({
      studyId,
      userId: member.user.id,
      token: leader.accessToken,
    });

    const session = await request(app)
      .post(`/studies/${studyId}/sessions`)
      .set("Authorization", `Bearer ${leader.accessToken}`)
      .send({ title: "Week 1", date: new Date().toISOString() });

    await request(app)
      .post(`/studies/${studyId}/sessions/${session.body.session.id}/attendance`)
      .set("Authorization", `Bearer ${member.accessToken}`)
      .send({ status: "PRESENT" });

    const memberSummary = await request(app)
      .get(`/studies/${studyId}/attendance/summary`)
      .set("Authorization", `Bearer ${member.accessToken}`);
    expect(memberSummary.status).toBe(403);

    const memberAttendanceList = await request(app)
      .get(`/studies/${studyId}/sessions/${session.body.session.id}/attendance`)
      .set("Authorization", `Bearer ${member.accessToken}`);
    expect(memberAttendanceList.status).toBe(403);
  });
});
