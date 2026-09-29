import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, createUser } from "./db";

const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
const C = "00000000-0000-0000-0000-00000000000c";

let db: PGlite;
let farmId: string;

async function createFarm(userId: string) {
  const [row] = await asUser<{ id: string }>(
    db,
    userId,
    "select public.create_farm('주말농장', 37.5, 127.0, 10, 5) as id",
  );
  return row.id;
}

async function createInvite(userId: string, farm: string) {
  const [row] = await asUser<{ token: string }>(
    db,
    userId,
    "select public.create_farm_invite($1) as token",
    [farm],
  );
  return row.token;
}

beforeAll(async () => {
  db = await createTestDb();
  await createUser(db, A);
  await createUser(db, B);
  await createUser(db, C);
  farmId = await createFarm(A);
});

describe("farms RLS", () => {
  it("creator is owner and can read farm", async () => {
    const farms = await asUser<{ id: string }>(db, A, "select id from farms");
    expect(farms.map((f) => f.id)).toEqual([farmId]);
    const members = await asUser<{ role: string }>(db, A, "select role from farm_members");
    expect(members).toEqual([{ role: "owner" }]);
  });

  it("non-member cannot read farm, members or invites", async () => {
    await createInvite(A, farmId);
    expect(await asUser(db, C, "select * from farms")).toEqual([]);
    expect(await asUser(db, C, "select * from farm_members")).toEqual([]);
    expect(await asUser(db, C, "select * from farm_invites")).toEqual([]);
  });

  it("non-member cannot update farm", async () => {
    await asUser(db, C, "update farms set name = 'hacked'");
    const [farm] = await asUser<{ name: string }>(db, A, "select name from farms");
    expect(farm.name).toBe("주말농장");
  });

  it("direct insert into farm_members is blocked", async () => {
    await expect(
      asUser(db, C, "insert into farm_members (farm_id, user_id) values ($1, $2)", [farmId, C]),
    ).rejects.toThrow(/row-level security/);
  });

  it("anon cannot call RPCs", async () => {
    await expect(asUser(db, null, "select public.create_farm('x', 0, 0, 1, 1)")).rejects.toThrow(
      /permission denied/,
    );
  });

  it("non-member cannot create invite", async () => {
    await expect(createInvite(C, farmId)).rejects.toThrow(/not a farm member/);
  });
});

describe("invites", () => {
  it("invite lets second user join, then both see same farm", async () => {
    const token = await createInvite(A, farmId);
    const [joined] = await asUser<{ id: string }>(
      db,
      B,
      "select public.accept_farm_invite($1) as id",
      [token],
    );
    expect(joined.id).toBe(farmId);

    const farmsB = await asUser<{ id: string }>(db, B, "select id from farms");
    expect(farmsB.map((f) => f.id)).toEqual([farmId]);
    const members = await asUser<{ user_id: string; role: string }>(
      db,
      B,
      "select user_id, role from farm_members order by role",
    );
    expect(members).toEqual([
      { user_id: A, role: "owner" },
      { user_id: B, role: "member" },
    ]);

    // 1회 사용 제한
    await expect(
      asUser(db, C, "select public.accept_farm_invite($1)", [token]),
    ).rejects.toThrow(/invite_used/);
  });

  it("expired invite is rejected", async () => {
    const token = await createInvite(A, farmId);
    await db.query(
      "update farm_invites set expires_at = now() - interval '1 minute' where used_at is null",
    );
    await expect(
      asUser(db, C, "select public.accept_farm_invite($1)", [token]),
    ).rejects.toThrow(/invite_expired/);
  });

  it("unknown token is rejected", async () => {
    await expect(
      asUser(db, C, "select public.accept_farm_invite('nope')"),
    ).rejects.toThrow(/invite_not_found/);
  });

  it("stored invite has hash only, not raw token", async () => {
    const token = await createInvite(A, farmId);
    const rows = await db.query<{ n: number }>(
      "select count(*)::int as n from farm_invites where token_hash = $1",
      [token],
    );
    expect(rows.rows[0].n).toBe(0);
  });
});
