const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const userService = require('../services/userService');

passport.use(new LocalStrategy({ usernameField: 'email', passwordField: 'password' },
  async (email, password, done) => {
    try {
      const user = await userService.findByEmail(email);
      if (!user) return done(null, false, { message: 'Invalid email or password.' });
      const ok = await userService.verifyPassword(user, password);
      if (!ok) return done(null, false, { message: 'Invalid email or password.' });
      await userService.touchLastLogin(user.id);
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  }
));

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const user = await userService.findById(id);
    if (!user || !user.active) return done(null, false);
    done(null, user);
  } catch (err) {
    done(err);
  }
});

module.exports = passport;
