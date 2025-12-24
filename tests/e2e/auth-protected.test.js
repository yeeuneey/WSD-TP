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

describe("Auth-protected endpoints", () => {
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

  it("rejects unauthenticated requests to protected routes", async () => {
    const studiesRes = await request(app).get("/studies");
    expect(studiesRes.status).toBe(401);
    expect(studiesRes.body.code).toBe("UNAUTHORIZED");

    const profileRes = await request(app).get("/users/me");
    expect(profileRes.status).toBe(401);
    expect(profileRes.body.code).toBe("UNAUTHORIZED");
  });

  it("updates the authenticated user's profile name", async () => {
    const user = await register();

    const updateRes = await request(app)
      .patch("/users/me")
      .set("Authorization", `Bearer ${user.accessToken}`)
      .send({ name: "Updated Name" });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.user.name).toBe("Updated Name");

    const profile = await request(app)
      .get("/users/me")
      .set("Authorization", `Bearer ${user.accessToken}`);

    expect(profile.status).toBe(200);
    expect(profile.body.user.name).toBe("Updated Name");
  });

  it("allows password change and login with the new password", async () => {
    const email = `pw-${Date.now()}@example.com`;
    const password = "Password123!";
    const { accessToken } = await register({ email, password });

    const changeRes = await request(app)
      .patch("/users/me/password")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ currentPassword: password, newPassword: "NewPass123!" });

    expect(changeRes.status).toBe(200);
    expect(changeRes.body.success).toBe(true);

    const loginNew = await request(app).post("/auth/login").send({
      email,
      password: "NewPass123!",
    });
    expect(loginNew.status).toBe(200);
    expect(loginNew.body.accessToken).toBeDefined();

    const loginOld = await request(app).post("/auth/login").send({
      email,
      password,
    });
    expect(loginOld.status).toBe(401);
    expect(loginOld.body.code).toBe("INVALID_CREDENTIALS");
  });

  it("rejects password change when current password is incorrect", async () => {
    const user = await register();

    const changeRes = await request(app)
      .patch("/users/me/password")
      .set("Authorization", `Bearer ${user.accessToken}`)
      .send({ currentPassword: "WrongPass!", newPassword: "Another123!" });

    expect(changeRes.status).toBe(400);
    expect(changeRes.body.code).toBe("INVALID_PASSWORD");
  });

  it("revokes access after logout via token blacklist", async () => {
    const user = await register();

    const logoutRes = await request(app)
      .post("/auth/logout")
      .set("Authorization", `Bearer ${user.accessToken}`)
      .send({ refreshToken: user.refreshToken });

    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body.success).toBe(true);

    const profileRes = await request(app)
      .get("/users/me")
      .set("Authorization", `Bearer ${user.accessToken}`);

    expect(profileRes.status).toBe(401);
    expect(profileRes.body.code).toBe("TOKEN_REVOKED");
  });

  it("returns my attendance records", async () => {
    const leader = await register();
    const member = await register();

    const { body: studyBody } = await request(app)
      .post("/studies")
      .set("Authorization", `Bearer ${leader.accessToken}`)
      .send({ title: "Attendance", description: "desc" });

    await request(app)
      .post(`/studies/${studyBody.study.id}/join`)
      .set("Authorization", `Bearer ${member.accessToken}`);
    await request(app)
      .patch(`/studies/${studyBody.study.id}/members/${member.user.id}/status`)
      .set("Authorization", `Bearer ${leader.accessToken}`)
      .send({ status: "APPROVED" });

    const session = await request(app)
      .post(`/studies/${studyBody.study.id}/sessions`)
      .set("Authorization", `Bearer ${leader.accessToken}`)
      .send({ title: "Week 1", date: new Date().toISOString() });

    await request(app)
      .post(`/studies/${studyBody.study.id}/sessions/${session.body.session.id}/attendance`)
      .set("Authorization", `Bearer ${member.accessToken}`)
      .send({ status: "PRESENT" });

    const myAttendance = await request(app)
      .get("/users/me/attendance")
      .set("Authorization", `Bearer ${member.accessToken}`);

    expect(myAttendance.status).toBe(200);
    expect(myAttendance.body.records.length).toBeGreaterThan(0);
    expect(myAttendance.body.records[0].session.study.id).toBe(studyBody.study.id);
  });

  it("requires payload for google login", async () => {
    const res = await request(app).post("/auth/google").send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_PAYLOAD");
  });
});
