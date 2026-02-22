const express = require("express");
const { listCapabilityRegistry } = require("../services/capabilities");

const router = express.Router();

router.get("/", (_req, res) => {
  const operations = listCapabilityRegistry();
  res.json({
    operations,
    generatedAt: new Date().toISOString()
  });
});

module.exports = router;

