// Hirarki akses: super_admin = direktur_coe = wakil_direktur_coe = sekretaris_coe (top-tier/admin) > dosen = member
// dosen dan member setara: hanya akses Task & Workspace, tanpa KPI dan Administrasi
const TOP_TIER_ROLES = ['super_admin', 'direktur_coe', 'wakil_direktur_coe', 'sekretaris_coe'];
const BASIC_ROLES = ['dosen', 'member'];
// Sekretaris CoE tetap top-tier (akses admin), tapi juga ikut dihitung sebagai anggota tim di KPI/Workload
const KPI_SUBJECT_ROLES = ['dosen', 'member', 'sekretaris_coe'];
const ROLE_LEVEL = { super_admin: 2, direktur_coe: 2, wakil_direktur_coe: 2, sekretaris_coe: 2, dosen: 1, member: 1 };

function requireRole(...roles) {
  return (req, res, next) => {
    if (TOP_TIER_ROLES.includes(req.user.role) || roles.includes(req.user.role)) return next();
    return res.status(403).json({ message: 'Akses ditolak: hak akses tidak mencukupi' });
  };
}

// Top-tier/admin-level akses: super_admin, direktur_coe, wakil_direktur_coe, dan sekretaris_coe setara
function requireSuperadmin(req, res, next) {
  if (!TOP_TIER_ROLES.includes(req.user.role))
    return res.status(403).json({ message: 'Akses ditolak: hanya Super Admin / Direktur CoE / Wakil Direktur CoE / Sekretaris CoE' });
  next();
}

// Minimal level sekretaris_coe ke atas (wakil_direktur_coe, sekretaris_coe, direktur_coe — semua setara)
function requireDireksiUp(req, res, next) {
  const level = ROLE_LEVEL[req.user.role] || 0;
  if (level >= 2) return next();
  return res.status(403).json({ message: 'Akses ditolak: hanya Sekretaris CoE ke atas' });
}

module.exports = { requireRole, requireSuperadmin, requireDireksiUp, ROLE_LEVEL, TOP_TIER_ROLES, BASIC_ROLES, KPI_SUBJECT_ROLES };
