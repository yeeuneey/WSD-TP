const request = require("supertest");
const app = require("../../src/app").default;
const { prisma } = require("../../src/config/db");
const {
  redis,
  ensureRedisConnection,
} = require("../../src/config/redis");
const { ensureSchema } = require("../helpers/ensure-schema");

const clearDatabase = async () => {
  await prisma.attendanceRecord.deleteMany();
  await prisma.attendanceSession.deleteMany();
  await prisma.studyMember.deleteMany();
  await prisma.study.deleteMany();
  await prisma.user.deleteMany();
};

describe("Auth and User flows", () => {
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

  const registerUser = (overrides = {}) => {
    const payload = {
      email: `test-${Date.now()}@example.com`,
      password: "Password123!",
      name: "Test User",
      ...overrides,
    };
    return request(app).post("/auth/register").send(payload);
  };

  it("registers a user and prevents duplicate emails", async () => {
    const response = await registerUser();
    expect(response.status).toBe(201);
    expect(response.body.accessToken).toBeDefined();
    expect(response.body.refreshToken).toBeDefined();

    const duplicate = await request(app).post("/auth/register").send({
      email: response.body.user.email,
      password: "Password123!",
      name: "Another User",
    });

    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe("EMAIL_TAKEN");
  });

  it("logs in, refreshes, and logs out a user", async () => {
    const email = `login-${Date.now()}@example.com`;
    const password = "Password123!";

    await registerUser({ email, password });

    const login = await request(app).post("/auth/login").send({
      email,
      password,
    });

    expect(login.status).toBe(200);
    const { accessToken, refreshToken } = login.body;

    const profile = await request(app)
      .get("/users/me")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(profile.status).toBe(200);
    expect(profile.body.user.email).toBe(email.toLowerCase());

    const refresh = await request(app).post("/auth/refresh").send({
      refreshToken,
    });

    expect(refresh.status).toBe(200);
    expect(refresh.body.accessToken).not.toBe(accessToken);

    const logout = await request(app)
      .post("/auth/logout")
      .set("Authorization", `Bearer ${refresh.body.accessToken}`)
      .send({ refreshToken: refresh.body.refreshToken });

    expect(logout.status).toBe(200);

    const reuseRefresh = await request(app).post("/auth/refresh").send({
      refreshToken,
    });

    expect(reuseRefresh.status).toBe(401);
  });

  it("rejects invalid login attempts", async () => {
    const email = `invalid-${Date.now()}@example.com`;
    const password = "Password123!";
    await registerUser({ email, password });

    const wrongPassword = await request(app).post("/auth/login").send({
      email,
      password: "WrongPassword!",
    });

    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.body.code).toBe("INVALID_CREDENTIALS");
  });

  it("validates payloads for social login endpoints", async () => {
    const google = await request(app).post("/auth/google").send({});
    expect(google.status).toBe(400);
    expect(google.body.code).toBe("INVALID_PAYLOAD");

    const kakao = await request(app).post("/auth/kakao").send({});
    expect(kakao.status).toBe(400);
    expect(kakao.body.code).toBe("INVALID_PAYLOAD");

    const firebase = await request(app).post("/auth/firebase").send({});
    expect(firebase.status).toBe(400);
    expect(firebase.body.code).toBe("INVALID_PAYLOAD");
  });
});
