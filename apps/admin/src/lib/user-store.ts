/**
 * Three-tier user store backed by Upstash Redis.
 *
 * Key schema:
 *   audit:user:{openid}            — Hash with role, name, phone, status, etc.
 *   audit:users-by-role:{role}     — Set of openids
 *   audit:user-by-phone:{phone}    — String → openid  (phone-based lookup for PC login)
 *
 * Roles: specialist | supervisor | leader
 */

export type UserRole = "specialist" | "supervisor" | "leader";

export interface AppUser {
  openid: string;
  role: UserRole;
  name: string;
  phone: string;
  password?: string;
  status: "active" | "disabled";
  createdAt: string;
  createdBy: string;
  /** 副负责人（由主负责人在后台创建，存 Redis）；环境变量中的负责人不写此字段 */
  leaderKind?: "delegated";
}

function isRedisConfigured() {
  return Boolean(
    process.env.KV_REST_API_URL?.trim() && process.env.KV_REST_API_TOKEN?.trim(),
  );
}

let redisInstance: import("@upstash/redis").Redis | null = null;

async function getRedis() {
  if (redisInstance) return redisInstance;
  const { Redis } = await import("@upstash/redis");
  redisInstance = new Redis({
    url: process.env.KV_REST_API_URL!,
    token: process.env.KV_REST_API_TOKEN!,
  });
  return redisInstance;
}

function userKey(openid: string) {
  return `audit:user:${openid}`;
}

function roleSetKey(role: UserRole) {
  return `audit:users-by-role:${role}`;
}

function phoneKey(phone: string) {
  return `audit:user-by-phone:${phone}`;
}

/* ------------------------------------------------------------------ */
/*  CRUD                                                               */
/* ------------------------------------------------------------------ */

export async function getUserByOpenid(openid: string): Promise<AppUser | null> {
  if (!isRedisConfigured()) return null;
  const redis = await getRedis();
  const raw = await redis.get<string>(userKey(openid));
  if (!raw) return null;
  return typeof raw === "string"
    ? (JSON.parse(raw) as AppUser)
    : (raw as unknown as AppUser);
}

export async function getUserByPhone(phone: string): Promise<AppUser | null> {
  if (!isRedisConfigured()) return null;
  const redis = await getRedis();
  const openid = await redis.get<string>(phoneKey(phone));
  if (!openid) return null;
  return getUserByOpenid(typeof openid === "string" ? openid : String(openid));
}

export async function createUser(user: AppUser): Promise<AppUser> {
  if (!isRedisConfigured()) {
    throw new Error("User store requires Redis (KV_REST_API_URL).");
  }

  const redis = await getRedis();
  const pipeline = redis.pipeline();
  pipeline.set(userKey(user.openid), JSON.stringify(user));
  pipeline.sadd(roleSetKey(user.role), user.openid);
  if (user.phone.trim()) {
    pipeline.set(phoneKey(user.phone), user.openid);
  }
  await pipeline.exec();
  return user;
}

export async function updateUser(
  openid: string,
  patch: Partial<Omit<AppUser, "openid">>,
): Promise<AppUser | null> {
  const current = await getUserByOpenid(openid);
  if (!current) return null;

  const updated: AppUser = { ...current, ...patch };
  const redis = await getRedis();
  const pipeline = redis.pipeline();
  pipeline.set(userKey(openid), JSON.stringify(updated));

  if (patch.role && patch.role !== current.role) {
    pipeline.srem(roleSetKey(current.role), openid);
    pipeline.sadd(roleSetKey(patch.role), openid);
  }

  if (patch.phone && patch.phone !== current.phone) {
    if (current.phone.trim()) {
      pipeline.del(phoneKey(current.phone));
    }
    pipeline.set(phoneKey(patch.phone), openid);
  }

  await pipeline.exec();
  return updated;
}

export async function listUsersByRole(role: UserRole): Promise<AppUser[]> {
  if (!isRedisConfigured()) return [];
  const redis = await getRedis();
  const openids = (await redis.smembers(roleSetKey(role))) as string[];
  if (openids.length === 0) return [];

  const pipeline = redis.pipeline();
  for (const id of openids) {
    pipeline.get(userKey(id));
  }
  const results = await pipeline.exec();
  const users: AppUser[] = [];
  for (const raw of results) {
    if (!raw) continue;
    const user =
      typeof raw === "string"
        ? (JSON.parse(raw) as AppUser)
        : (raw as unknown as AppUser);
    if (user?.openid) users.push(user);
  }
  return users;
}

export async function listAllUsers(): Promise<AppUser[]> {
  const [specialists, supervisors, leaders] = await Promise.all([
    listUsersByRole("specialist"),
    listUsersByRole("supervisor"),
    listUsersByRole("leader"),
  ]);
  return [...leaders, ...supervisors, ...specialists];
}

/* ------------------------------------------------------------------ */
/*  Leader accounts from environment variables                         */
/* ------------------------------------------------------------------ */

export interface LeaderAccount {
  phone: string;
  password: string;
}

export function getLeaderAccounts(): LeaderAccount[] {
  const raw = process.env.LEADER_ACCOUNTS?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => {
      const [phone, ...rest] = entry.trim().split(":");
      return { phone: phone?.trim() || "", password: rest.join(":").trim() };
    })
    .filter((a) => a.phone && a.password);
}

export function isLeaderPhone(phone: string): boolean {
  return getLeaderAccounts().some((a) => a.phone === phone);
}

export function verifyLeaderCredentials(phone: string, password: string): boolean {
  return getLeaderAccounts().some((a) => a.phone === phone && a.password === password);
}

/** 主负责人手机号：优先 PRIMARY_LEADER_PHONE，否则为 LEADER_ACCOUNTS 中第一条 */
export function getPrimaryLeaderPhone(): string | null {
  const explicit = process.env.PRIMARY_LEADER_PHONE?.trim();
  if (explicit) return explicit;
  const first = getLeaderAccounts()[0];
  return first?.phone ?? null;
}

/** 用于账号管理页展示：环境变量中的负责人（含主/并列） */
export function getEnvLeaderSummaries(): { phone: string; slot: "primary" | "env" }[] {
  const accounts = getLeaderAccounts();
  const primary = getPrimaryLeaderPhone();
  return accounts.map((a) => ({
    phone: a.phone,
    slot: a.phone === primary ? "primary" : "env",
  }));
}

export function isPrimaryLeaderPhone(phone: string): boolean {
  const p = getPrimaryLeaderPhone();
  return Boolean(p && p === phone.trim());
}

export type PcLeaderSessionKind = "primary" | "env" | "delegated" | "none";

export type ResolvePcLoginResult =
  | {
      ok: true;
      role: "leader";
      leaderSessionKind: "primary" | "env" | "delegated";
      name: string;
    }
  | { ok: true; role: "supervisor"; name: string }
  | { ok: false };

/**
 * PC 端登录：环境负责人 → Redis 副负责人 → 主管
 */
export async function resolvePcLogin(
  phone: string,
  password: string,
): Promise<ResolvePcLoginResult> {
  const p = phone.trim();
  if (verifyLeaderCredentials(p, password)) {
    const leaderSessionKind = isPrimaryLeaderPhone(p) ? "primary" : "env";
    return {
      ok: true,
      role: "leader",
      leaderSessionKind,
      name: "负责人",
    };
  }

  const user = await getUserByPhone(p);
  if (user?.status === "active") {
    const userPwd = user.password?.trim() || user.phone;
    if (
      user.role === "leader" &&
      user.leaderKind === "delegated" &&
      password === userPwd
    ) {
      return {
        ok: true,
        role: "leader",
        leaderSessionKind: "delegated",
        name: user.name || "副负责人",
      };
    }
    if (user.role === "supervisor" && password === userPwd) {
      return { ok: true, role: "supervisor", name: user.name };
    }
  }

  return { ok: false };
}

/** 该手机号是否为「负责人」账号（含环境配置与副负责人），用于避免误匹配主管逻辑 */
export async function isAnyLeaderPhone(phone: string): Promise<boolean> {
  const p = phone.trim();
  if (isLeaderPhone(p)) return true;
  const user = await getUserByPhone(p);
  return user?.role === "leader" && user.leaderKind === "delegated";
}
