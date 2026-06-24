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

  async touch(sid, sessionData, cb) {
    return this.set(sid, sessionData, cb || (() => {}));
  }
}

module.exports = LibsqlSessionStore;
