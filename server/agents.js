// Seed defaults for the team roster. Canonical store is data/team.json;
// this file only feeds first boot and documents the two AI roles.
const seed = require('./team').SEED.filter(m => m.ai);
module.exports = Object.fromEntries(seed.map(m => [m.n, {role: m.role, model: m.ai.model, system: m.ai.system}]));
