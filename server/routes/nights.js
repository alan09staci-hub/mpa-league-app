'use strict';
// "Your nights" endpoint: the nights one signed-in player is part of.
// Public, like the night lists — the personId is the device-local
// tap-your-name identity, so this is a view-level lookup, not a sign-in
// lock. Mounted at /api (see server/index.js).
const express = require('express');
const { myNights, asInt } = require('../lib/nights');

const router = express.Router();

async function handle(fn, req, res) {
  try {
    await fn(req, res);
  } catch (e) {
    console.error(e);
    res.status(e.status || 500).json({ error: e.message || 'Server error.' });
  }
}

router.get('/my-nights', (req, res) =>
  handle(async () => {
    const personId = asInt(req.query.personId);
    if (personId == null) return res.json({ nights: [] });
    res.json({ nights: await myNights(personId) });
  }, req, res)
);

module.exports = router;
