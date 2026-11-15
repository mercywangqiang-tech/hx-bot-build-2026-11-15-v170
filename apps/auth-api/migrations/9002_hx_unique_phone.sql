-- HXBot: one account per mobile number (v1.6.2). The email and the username were unique from the start
-- (the primary key and username_key); the mobile number was only indexed. A number belongs to the account
-- that registered it first. Accounts made before this keep their numbers: where two of them have the same
-- number, it belongs to the earlier one, and no new account can take a number that is in use.
CREATE TABLE hx_phone_owners (
  phone TEXT PRIMARY KEY,
  email TEXT NOT NULL REFERENCES hx_accounts(email) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO hx_phone_owners(phone, email, created_at)
  SELECT phone, email, created_at FROM hx_accounts ORDER BY created_at, email;
