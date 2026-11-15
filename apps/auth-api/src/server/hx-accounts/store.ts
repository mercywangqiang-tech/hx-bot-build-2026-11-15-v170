/**
 * HXBot：注册账号的数据（迁移 9001_hx_accounts.sql 里的四张表，9002_hx_unique_phone.sql 的手机号归属表），以及往上游的登录挑战表里
 * 放“一次性登录票据”。数据库是账号服务自带的 SQLite（workerd 的 D1），不另装数据库服务。
 */

/** What a new account could not get because another account has it, or `created`. */
export type HxCreateOutcome = "created" | "email" | "username" | "phone";

/** The part of a D1 database that this module uses. A test passes a SQLite database behind the same shape. */
export interface HxDatabase {
  prepare(sql: string): HxStatement;
}

export interface HxStatement {
  bind(...values: (string | number | null)[]): HxStatement;
  first<Row>(): Promise<Row | null>;
  all<Row>(): Promise<{ results: Row[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}

export interface HxAccountRow {
  email: string;
  username: string;
  phone: string;
  phone_verified_at: number | null;
  job_title: string;
  company: string;
  email_verified_at: number | null;
  password_salt: string | null;
  password_hash: string | null;
  password_iterations: number | null;
  disabled_at: number | null;
  created_at: number;
}

export interface HxPendingRow {
  kind: string;
  email: string | null;
  phone: string | null;
  email_code_hash: string | null;
  phone_code_hash: string | null;
  data: string;
  failed_attempts: number;
  created_at: number;
  expires_at: number;
}

export interface HxNewAccount {
  email: string;
  username: string;
  phone: string;
  phoneVerified: boolean;
  jobTitle: string;
  company: string;
  emailVerified: boolean;
  password: { salt: string; hash: string; iterations: number } | null;
}

const ACCOUNT_COLUMNS =
  "email, username, phone, phone_verified_at, job_title, company, email_verified_at, password_salt, password_hash, password_iterations, disabled_at, created_at";

export class HxAccountStore {
  readonly #database: HxDatabase;

  constructor(database: HxDatabase) {
    this.#database = database;
  }

  account(email: string): Promise<HxAccountRow | null> {
    return this.#database
      .prepare(`SELECT ${ACCOUNT_COLUMNS} FROM hx_accounts WHERE email = ?`)
      .bind(email)
      .first<HxAccountRow>();
  }

  async usernameTaken(username: string): Promise<boolean> {
    const row = await this.#database
      .prepare("SELECT 1 AS taken FROM hx_accounts WHERE username_key = ?")
      .bind(username.toLowerCase())
      .first<{ taken: number }>();
    return row !== null;
  }

  /**
   * True when an account has this mobile number. A number belongs to one account (9002_hx_unique_phone.sql);
   * an account made before that rule may still share a number, so the accounts themselves count as well.
   */
  async phoneTaken(phone: string): Promise<boolean> {
    const row = await this.#database
      .prepare(
        "SELECT 1 AS taken FROM hx_phone_owners WHERE phone = ? UNION ALL SELECT 1 AS taken FROM hx_accounts WHERE phone = ? LIMIT 1",
      )
      .bind(phone, phone)
      .first<{ taken: number }>();
    return row !== null;
  }

  /** True when the email signed in before accounts had their own password: `users` knows it, `hx_accounts` does not. */
  async earlierUser(email: string): Promise<boolean> {
    const row = await this.#database
      .prepare("SELECT 1 AS found FROM users WHERE email = ?")
      .bind(email)
      .first<{ found: number }>();
    return row !== null;
  }

  /**
   * Adds the account and makes its mobile number its own. When another account took the email, the
   * username or the number in the meantime, nothing is added and the outcome names what was taken.
   */
  async createAccount(account: HxNewAccount, now: number): Promise<HxCreateOutcome> {
    const result = await this.#database
      .prepare(
        `INSERT INTO hx_accounts(
          email, username, username_key, phone, phone_verified_at, job_title, company, email_verified_at,
          password_salt, password_hash, password_iterations, password_updated_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT DO NOTHING`,
      )
      .bind(
        account.email,
        account.username,
        account.username.toLowerCase(),
        account.phone,
        account.phoneVerified ? now : null,
        account.jobTitle,
        account.company,
        account.emailVerified ? now : null,
        account.password?.salt ?? null,
        account.password?.hash ?? null,
        account.password?.iterations ?? null,
        account.password ? now : null,
        now,
        now,
      )
      .run();
    if (result.meta.changes !== 1) return (await this.account(account.email)) ? "email" : "username";
    // The account row comes first: the owner row points at it.
    const owner = await this.#database
      .prepare("INSERT INTO hx_phone_owners(phone, email, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING")
      .bind(account.phone, account.email, now)
      .run();
    if (owner.meta.changes === 1) return "created";
    await this.#database.prepare("DELETE FROM hx_accounts WHERE email = ?").bind(account.email).run();
    return "phone";
  }

  /**
   * Removes what the account service keeps about one person, as scripts/delete-account.sh does for the
   * administrator: the registration details, linked outside accounts, the owner row of the mobile number,
   * pending registrations and resets, invitations to the email, sign-in challenges, and the user, whose
   * sessions, mobile sign-ins, memberships and published servers go with it (foreign keys). True when the
   * user row is gone.
   */
  async deletePerson(email: string, userId: string | null): Promise<boolean> {
    const run = (sql: string, ...values: string[]) =>
      this.#database
        .prepare(sql)
        .bind(...values)
        .run();
    await run("DELETE FROM hx_pending WHERE email = ?", email);
    await run("DELETE FROM hx_identities WHERE email = ?", email);
    await run("DELETE FROM hx_phone_owners WHERE email = ?", email);
    await run("DELETE FROM hx_accounts WHERE email = ?", email);
    await run("DELETE FROM remote_invites WHERE lower(email) = ?", email);
    await run("DELETE FROM email_login_challenges WHERE lower(email) = ?", email);
    if (userId) await run("DELETE FROM users WHERE id = ?", userId);
    const left = await this.#database
      .prepare(
        "SELECT (SELECT count(*) FROM hx_accounts WHERE email = ?) + (SELECT count(*) FROM users WHERE id = ?) AS n",
      )
      .bind(email, userId ?? "")
      .first<{ n: number }>();
    return (left?.n ?? 0) === 0;
  }

  async setPassword(
    email: string,
    password: { salt: string; hash: string; iterations: number },
    now: number,
  ): Promise<boolean> {
    const result = await this.#database
      .prepare(
        `UPDATE hx_accounts SET password_salt = ?, password_hash = ?, password_iterations = ?,
           password_updated_at = ?, updated_at = ? WHERE email = ?`,
      )
      .bind(password.salt, password.hash, password.iterations, now, now, email)
      .run();
    return result.meta.changes === 1;
  }

  /**
   * Ends every sign-in of this email, as `scripts/users.sh reset-password` does. The trigger on `revoked_at`
   * ends the remote sessions of these sessions too (see company-sign-in.ts).
   */
  async signOutEverywhere(email: string, now: number): Promise<void> {
    await this.#database
      .prepare(
        `UPDATE auth_sessions SET revoked_at = ?
         WHERE revoked_at IS NULL AND user_id IN (SELECT id FROM users WHERE lower(email) = ?)`,
      )
      .bind(now, email)
      .run();
  }

  async markEmailVerified(email: string, now: number): Promise<void> {
    await this.#database
      .prepare(
        "UPDATE hx_accounts SET email_verified_at = COALESCE(email_verified_at, ?), updated_at = ? WHERE email = ?",
      )
      .bind(now, now, email)
      .run();
  }

  /**
   * The row of `users` for a new account, with the username as the display name. The sign-in that
   * follows finds it by the email. An earlier user keeps the name they chose.
   */
  async ensureUser(email: string, name: string, now: number): Promise<void> {
    await this.#database
      .prepare(
        `INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?) ON CONFLICT DO NOTHING`,
      )
      .bind(crypto.randomUUID(), `email:${email}`, email, name, now, now)
      .run();
    await this.#database
      .prepare("UPDATE users SET name = ?, updated_at = ? WHERE email = ? AND (name IS NULL OR name = '')")
      .bind(name, now, email)
      .run();
  }

  /** How many times this key was counted in the window, this time included (the table of `auth-service.ts`). */
  async countAttempt(keyHash: string, windowStart: number): Promise<number> {
    const row = await this.#database
      .prepare(
        `INSERT INTO auth_rate_limits(key_hash, window_start, attempts) VALUES (?, ?, 1)
         ON CONFLICT(key_hash, window_start) DO UPDATE SET attempts = attempts + 1
         RETURNING attempts`,
      )
      .bind(keyHash, windowStart)
      .first<{ attempts: number }>();
    return row?.attempts ?? Number.MAX_SAFE_INTEGER;
  }

  // ---- 第三方账号 ----

  async identityEmail(provider: string, subject: string): Promise<string | null> {
    const row = await this.#database
      .prepare("SELECT email FROM hx_identities WHERE provider = ? AND subject = ?")
      .bind(provider, subject)
      .first<{ email: string }>();
    return row?.email ?? null;
  }

  /** False when this outside account already signs another person in. */
  async linkIdentity(
    provider: string,
    subject: string,
    email: string,
    displayName: string | null,
    now: number,
  ): Promise<boolean> {
    await this.#database
      .prepare(
        `INSERT INTO hx_identities(provider, subject, email, display_name, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(provider, subject) DO NOTHING`,
      )
      .bind(provider, subject, email, displayName, now)
      .run();
    return (await this.identityEmail(provider, subject)) === email;
  }

  // ---- 没走完的注册、改密码、第三方登录 ----

  async createPending(
    idHash: string,
    pending: {
      kind: string;
      email: string | null;
      phone: string | null;
      emailCodeHash: string | null;
      phoneCodeHash: string | null;
      data: string;
    },
    now: number,
    expiresAt: number,
  ): Promise<void> {
    await this.#database
      .prepare(
        `INSERT INTO hx_pending(id_hash, kind, email, phone, email_code_hash, phone_code_hash, data, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        idHash,
        pending.kind,
        pending.email,
        pending.phone,
        pending.emailCodeHash,
        pending.phoneCodeHash,
        pending.data,
        now,
        expiresAt,
      )
      .run();
  }

  pending(idHash: string): Promise<HxPendingRow | null> {
    return this.#database
      .prepare(
        `SELECT kind, email, phone, email_code_hash, phone_code_hash, data, failed_attempts, created_at, expires_at
         FROM hx_pending WHERE id_hash = ?`,
      )
      .bind(idHash)
      .first<HxPendingRow>();
  }

  async countPendingFailure(idHash: string): Promise<void> {
    await this.#database
      .prepare("UPDATE hx_pending SET failed_attempts = failed_attempts + 1 WHERE id_hash = ?")
      .bind(idHash)
      .run();
  }

  /** True for the one caller that removes the row: a pending step finishes once. */
  async takePending(idHash: string): Promise<boolean> {
    const result = await this.#database.prepare("DELETE FROM hx_pending WHERE id_hash = ?").bind(idHash).run();
    return result.meta.changes === 1;
  }

  async latestPendingAt(kind: string, email: string): Promise<number | null> {
    const row = await this.#database
      .prepare("SELECT MAX(created_at) AS latest FROM hx_pending WHERE kind = ? AND email = ?")
      .bind(kind, email)
      .first<{ latest: number | null }>();
    return row?.latest ?? null;
  }

  async latestPhonePendingAt(phone: string): Promise<number | null> {
    const row = await this.#database
      .prepare("SELECT MAX(created_at) AS latest FROM hx_pending WHERE phone = ? AND phone_code_hash IS NOT NULL")
      .bind(phone)
      .first<{ latest: number | null }>();
    return row?.latest ?? null;
  }

  async removeExpired(now: number): Promise<void> {
    await this.#database.prepare("DELETE FROM hx_pending WHERE expires_at < ?").bind(now).run();
    // A ticket is spent or expired with its sign-in challenge, which lives ten minutes. A day is ample.
    await this.#database
      .prepare("DELETE FROM hx_tickets WHERE created_at < ?")
      .bind(now - 86_400_000)
      .run();
  }

  // ---- 一次性登录票据：一条登录挑战，核对的是本服务发的票据，不是密码 ----

  async createTicketChallenge(input: {
    idHash: string;
    email: string;
    codeHash: string;
    sourceIpHash: string;
    now: number;
    expiresAt: number;
  }): Promise<void> {
    await this.#database
      .prepare(
        `INSERT INTO email_login_challenges(
           id_hash, email, code_hash, source_ip_hash, created_at, expires_at, max_attempts, delivery_state
         ) VALUES (?, ?, ?, ?, ?, ?, 3, 'sent')`,
      )
      .bind(input.idHash, input.email, input.codeHash, input.sourceIpHash, input.now, input.expiresAt)
      .run();
    await this.#database
      .prepare("INSERT INTO hx_tickets(id_hash, created_at) VALUES (?, ?)")
      .bind(input.idHash, input.now)
      .run();
  }

  async isTicketChallenge(idHash: string): Promise<boolean> {
    const row = await this.#database
      .prepare("SELECT 1 AS found FROM hx_tickets WHERE id_hash = ?")
      .bind(idHash)
      .first<{ found: number }>();
    return row !== null;
  }

  async challengeEmail(idHash: string): Promise<string | null> {
    const row = await this.#database
      .prepare("SELECT email FROM email_login_challenges WHERE id_hash = ?")
      .bind(idHash)
      .first<{ email: string }>();
    return row?.email ?? null;
  }
}
