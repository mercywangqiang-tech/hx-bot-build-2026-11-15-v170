-- HXBot: registered accounts. A person registers with an email and a password of their own, in place of
-- the password that every person shared. The rows hang on the email, which is how `users` and the
-- sign-in challenges name a person too, so nothing here depends on how `users` makes its ids.
--
-- The number 9001 keeps HXBot's migrations after every migration of the upstream project.

CREATE TABLE hx_accounts (
  email TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  -- The username in lower case: two people cannot differ only in capitals.
  username_key TEXT NOT NULL UNIQUE,
  -- With the country code, such as +8613800138000.
  phone TEXT NOT NULL,
  phone_verified_at INTEGER,
  job_title TEXT NOT NULL,
  company TEXT NOT NULL,
  email_verified_at INTEGER,
  -- PBKDF2-HMAC-SHA256 of the password. NULL for an account that signs in only with another account.
  password_salt TEXT,
  password_hash TEXT,
  password_iterations INTEGER,
  password_updated_at INTEGER,
  disabled_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX hx_accounts_phone ON hx_accounts(phone);

-- An account at Google, Apple, WeChat, Alipay, Facebook or Douyin that signs this person in.
CREATE TABLE hx_identities (
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  email TEXT NOT NULL REFERENCES hx_accounts(email) ON DELETE CASCADE,
  display_name TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (provider, subject)
);

CREATE INDEX hx_identities_email ON hx_identities(email);

-- A registration, a new password or a sign-in with another account that is not finished yet.
-- `data` is JSON. The codes are stored as hashes, as the sign-in codes are.
CREATE TABLE hx_pending (
  id_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  email_code_hash TEXT,
  phone_code_hash TEXT,
  data TEXT NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX hx_pending_expires ON hx_pending(expires_at);

-- The sign-in challenges that take a one-time ticket from this service, not the person's password:
-- the last step of a registration, a new password and a sign-in with another account.
CREATE TABLE hx_tickets (
  id_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
