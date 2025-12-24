const request = require("supertest");
const app = require("../../src/app").default;
const { prisma } = require("../../src/config/db");
const { redis, ensureRedisConnection } = require("../../src/config/redis");

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
  const res = await request(app).post("/auth/register").send(payload);
  return res.body;
};

const createStudy = async ({ token, body }) => {
  return request(app)
    .post("/studies")
    .set("Authorization", `Bearer ${token}`)
    .send(body);
};

const approveMember = async ({ studyId, userId, token, status = "APPROVED" }) =>
  request(app)
    .patch(`/studies/${studyId}/members/${userId}/status`)
    .set("Authorization", `Bearer ${token}`)
    .send({ status });

describe("Studies extended flows", () => {
  beforeAll(async () => {
    await prisma.$connect();
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

  it("updates study info, changes status, and returns in /studies/me", async () => {
    const leader = await register({ email: `leader-${Date.now()}@ex.com` });
    const member = await register({ email: `member-${Date.now()}@ex.com` });

    const createRes = await createStudy({
      token: leader.accessToken,
      body: { title: "Old", description: "Old desc", category: "WEB", maxMembers: 5 },
    });
    const studyId = createRes.body.study.id;

    const updateRes = await request(app)
      .patch(`/studies/${studyId}`)
      .set("Authorization", `Bearer ${leader.accessToken}`)
      .send({ title: "New Title", maxMembers: 10 });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.study.title).toBe("New Title");
    expect(updateRes.body.study.maxMembers).toBe(10);

    const statusRes = await request(app)
      .patch(`/studies/${studyId}/status`)
      .set("Authorization", `Bearer ${leader.accessToken}`)
      .send({ status: "CLOSED" });
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.study.status).toBe("CLOSED");

    await request(app)
      .post(`/studies/${studyId}/join`)
      .set("Authorization", `Bearer ${member.accessToken}`);
    await approveMember({
      studyId,
      userId: member.user.id,
      token: leader.accessToken,
    });

    const myAsLeader = await request(app)
      .get("/studies/me")
      .set("Authorization", `Bearer ${leader.accessToken}`);
    expect(myAsLeader.status).toBe(200);
    expect(myAsLeader.body.studies[0].memberRole).toBe("LEADER");

    const myAsMember = await request(app)
      .get("/studies/me")
      .query({ role: "MEMBER" })
      .set("Authorization", `Bearer ${member.accessToken}`);
    expect(myAsMember.status).toBe(200);
    expect(myAsMember.body.studies[0].memberRole).toBe("MEMBER");
  });

  it("edits and deletes sessions", async () => {
    const leader = await register();
    const { body: studyBody } = await createStudy({
      token: leader.accessToken,
      body: { title: "Session Study", description: "Desc" },
    });
    const studyId = studyBody.study.id;

    const sessionRes = await request(app)
      .post(`/studies/${studyId}/sessions`)
      .set("Authorization", `Bearer ${leader.accessToken}`)
      .send({ title: "S1", date: new Date().toISOString() });
    const sessionId = sessionRes.body.session.id;

    const patchRes = await request(app)
      .patch(`/studies/${studyId}/sessions/${sessionId}`)
      .set("Authorization", `Bearer ${leader.accessToken}`)
      .send({ title: "Renamed" });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.session.title).toBe("Renamed");

    const deleteRes = await request(app)
      .delete(`/studies/${studyId}/sessions/${sessionId}`)
      .set("Authorization", `Bearer ${leader.accessToken}`);
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.success).toBe(true);
  });

  it("filters attendance summary by date range", async () => {
    const leader = await register();
    const member = await register();
    const { body: studyBody } = await createStudy({
      token: leader.accessToken,
      body: { title: "Filter", description: "Filter desc" },
    });
    const studyId = studyBody.study.id;

    await request(app)
      .post(`/studies/${studyId}/join`)
      .set("Authorization", `Bearer ${member.accessToken}`);
    await approveMember({ studyId, userId: member.user.id, token: leader.accessToken });

    const day1 = new Date("2024-01-01T00:00:00Z").toISOString();
    const day2 = new Date("2024-01-05T00:00:00Z").toISOString();

    const session1 = await request(app)
      .post(`/studies/${studyId}/sessions`)
      .set("Authorization", `Bearer ${leader.accessToken}`)
      .send({ title: "D1", date: day1 });
    const session2 = await request(app)
      .post(`/studies/${studyId}/sessions`)
      .set("Authorization", `Bearer ${leader.accessToken}`)
      .send({ title: "D2", date: day2 });

    await request(app)
      .post(`/studies/${studyId}/sessions/${session1.body.session.id}/attendance`)
      .set("Authorization", `Bearer ${member.accessToken}`)
      .send({ status: "PRESENT" });
    await request(app)
      .post(`/studies/${studyId}/sessions/${session2.body.session.id}/attendance`)
      .set("Authorization", `Bearer ${member.accessToken}`)
      .send({ status: "PRESENT" });

    const summaryAll = await request(app)
      .get(`/studies/${studyId}/attendance/summary`)
      .set("Authorization", `Bearer ${leader.accessToken}`);
    expect(summaryAll.status).toBe(200);
    expect(summaryAll.body.summary.total).toBe(2);

    const summaryFiltered = await request(app)
      .get(`/studies/${studyId}/attendance/summary`)
      .query({ from: "2024-01-02T00:00:00Z", to: "2024-01-10T00:00:00Z" })
      .set("Authorization", `Bearer ${leader.accessToken}`);
    expect(summaryFiltered.status).toBe(200);
    expect(summaryFiltered.body.summary.total).toBe(1);
  });

  it("supports member pagination, status updates, removal, and leave", async () => {
    const leader = await register();
    const m1 = await register();
    const m2 = await register();
    const m3 = await register();

    const { body: studyBody } = await createStudy({
      token: leader.accessToken,
      body: { title: "Members", description: "Members study", maxMembers: 5 },
    });
    const studyId = studyBody.study.id;

    const members = [m1, m2, m3];
    for (const mem of members) {
      await request(app)
        .post(`/studies/${studyId}/join`)
        .set("Authorization", `Bearer ${mem.accessToken}`);
      await approveMember({ studyId, userId: mem.user.id, token: leader.accessToken });
    }

    const page1 = await request(app)
      .get(`/studies/${studyId}/members`)
      .query({ page: 1, pageSize: 2 })
      .set("Authorization", `Bearer ${leader.accessToken}`);
    expect(page1.status).toBe(200);
    expect(page1.body.members.length).toBe(2);
    // total includes leader + approved members
    expect(page1.body.total).toBeGreaterThanOrEqual(4);

    const statusChange = await request(app)
      .patch(`/studies/${studyId}/members/${m3.user.id}/status`)
      .set("Authorization", `Bearer ${leader.accessToken}`)
      .send({ status: "REJECTED" });
    expect(statusChange.status).toBe(200);
    expect(statusChange.body.membership.status).toBe("REJECTED");

    const remove = await request(app)
      .delete(`/studies/${studyId}/members/${m2.user.id}`)
      .set("Authorization", `Bearer ${leader.accessToken}`);
    expect(remove.status).toBe(200);

    const leave = await request(app)
      .post(`/studies/${studyId}/members/leave`)
      .set("Authorization", `Bearer ${m1.accessToken}`);
    expect(leave.status).toBe(200);
  });

  it("supports sorting, deletion, and session attendance list by sessionId", async () => {
    const leader = await register();

    const first = await createStudy({
      token: leader.accessToken,
      body: { title: "A study", description: "first" },
    });
    const second = await createStudy({
      token: leader.accessToken,
      body: { title: "B study", description: "second" },
    });

    const listDesc = await request(app)
      .get("/studies")
      .query({ sort: "createdAt:desc" })
      .set("Authorization", `Bearer ${leader.accessToken}`);
    expect(listDesc.status).toBe(200);
    expect(listDesc.body.data[0].id).toBe(second.body.study.id);

    const listAsc = await request(app)
      .get("/studies")
      .query({ sort: "createdAt:asc" })
      .set("Authorization", `Bearer ${leader.accessToken}`);
    expect(listAsc.status).toBe(200);
    expect(listAsc.body.data[0].id).toBe(first.body.study.id);

    // Delete the first study
    const delRes = await request(app)
      .delete(`/studies/${first.body.study.id}`)
      .set("Authorization", `Bearer ${leader.accessToken}`);
    expect(delRes.status).toBe(200);
    expect(delRes.body.success).toBe(true);

    const detailAfterDelete = await request(app)
      .get(`/studies/${first.body.study.id}`)
      .set("Authorization", `Bearer ${leader.accessToken}`);
    expect(detailAfterDelete.status).toBe(404);

    // Session attendance by sessionId path
    const session = await request(app)
      .post(`/studies/${second.body.study.id}/sessions`)
      .set("Authorization", `Bearer ${leader.accessToken}`)
      .send({ title: "Week 1", date: new Date().toISOString() });

    const attendanceList = await request(app)
      .get(`/sessions/${session.body.session.id}/attendance`)
      .set("Authorization", `Bearer ${leader.accessToken}`);
    expect(attendanceList.status).toBe(200);
    expect(attendanceList.body.sessionId).toBe(session.body.session.id);
  });

  it("filters my studies by role and status", async () => {
    const leader = await register();
    const member = await register();

    const asLeader = await createStudy({
      token: leader.accessToken,
      body: { title: "Leader study", description: "L" },
    });
    await request(app)
      .patch(`/studies/${asLeader.body.study.id}/status`)
      .set("Authorization", `Bearer ${leader.accessToken}`)
      .send({ status: "CLOSED" });

    const asMember = await createStudy({
      token: leader.accessToken,
      body: { title: "Member study", description: "M" },
    });
    await request(app)
      .post(`/studies/${asMember.body.study.id}/join`)
      .set("Authorization", `Bearer ${member.accessToken}`);
    await approveMember({
      studyId: asMember.body.study.id,
      userId: member.user.id,
      token: leader.accessToken,
    });

    const closedLeaderOnly = await request(app)
      .get("/studies/me")
      .query({ status: "CLOSED", role: "LEADER" })
      .set("Authorization", `Bearer ${leader.accessToken}`);
    expect(closedLeaderOnly.status).toBe(200);
    expect(closedLeaderOnly.body.studies.every((s) => s.status === "CLOSED")).toBe(true);
    expect(closedLeaderOnly.body.studies.every((s) => s.memberRole === "LEADER")).toBe(true);

    const recruitingMemberOnly = await request(app)
      .get("/studies/me")
      .query({ status: "RECRUITING", role: "MEMBER" })
      .set("Authorization", `Bearer ${member.accessToken}`);
    expect(recruitingMemberOnly.status).toBe(200);
    expect(recruitingMemberOnly.body.studies.every((s) => s.status === "RECRUITING")).toBe(true);
    expect(recruitingMemberOnly.body.studies.every((s) => s.memberRole === "MEMBER")).toBe(true);
  });
});
