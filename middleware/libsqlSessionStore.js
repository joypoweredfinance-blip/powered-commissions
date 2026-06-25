const session = require('express-session');
const { run, get } = require('../db/client');

class LibsqlSessionStore extends session.Store {
  async get(sid, cb) {
    try {
      const row = await get(`SELECT sess, expires FROM sessions WHERE sid = ?`, [sid]);
      if (!row) return cb(null, null);
      if (row.expires && Number(row.expires) < Date.now()) {
        await run(`DELETE FROM sessions WHERE sid = ?`, [sid]);
        return cb(null, null);
      }
      cb(null, JSON.parse(row.sess));
    } catch (err) {
      cb(err);
    }
  }

  async set(sid, sessionData, cb) {
    try {
      const expires = sessionData.cookie && sessionData.cookie.expires
        ? new Date(sessionData.cookie.expires).getTime()
        : Date.now() + 7 * 24 * 60 * 60 * 1000;
      const sess = JSON.stringify(sessionData);
      await run(
        `INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?)
         ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires`,
        [sid, sess, expires]
      );
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  async destroy(sid, cb) {
    try {
      await run(`DELETE FROM sessions WHERE sid = ?`, [sid]);
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  // Deliberately not implemented. With `resave: false`, express-session calls touch() on
  // every request whose session wasn't otherwise modified — if touch() did a real write (as
  // it did before), that's a guaranteed extra DB round-trip on every single page load and API
  // call, app-wide, just to slide the expiry. Leaving it unimplemented means express-session
  // falls back to resave's "don't write if nothing changed" behavior: sessions now expire a
  // fixed 7 days from login rather than 7 days from last activity — a fine tradeoff for an
  // internal tool with a handful of users, in exchange for cutting a write off every request.
}

module.exports = LibsqlSessionStore;
