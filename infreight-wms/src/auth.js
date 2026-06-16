'use strict';
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { query } = require('./db');

const SECRET = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';

function sign(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role },
    SECRET,
    { expiresIn: '12h' }
  );
}

function hash(password) {
  return bcrypt.hash(password, 10);
}

// Express middleware: require a valid token. Optionally require a role.
function requireAuth(role) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    try {
      const payload = jwt.verify(token, SECRET);
      req.user = payload;
      if (role && payload.role !== role) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      next();
    } catch (e) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }
  };
}

async function login(email, password) {
  const { rows } = await query('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
  const user = rows[0];
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return null;
  return { token: sign(user), user: { id: user.id, email: user.email, name: user.name, role: user.role } };
}

module.exports = { sign, hash, requireAuth, login, SECRET };
