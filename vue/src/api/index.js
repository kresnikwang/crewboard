import axios from 'axios'

const http = axios.create({
  baseURL: '/api',
  timeout: 15000,
})

// Attach token on every request
http.interceptors.request.use((config) => {
  const token = localStorage.getItem('crewboard_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Unwrap data, handle errors uniformly
http.interceptors.response.use(
  (res) => res.data,
  (err) => {
    const msg = err.response?.data?.error || err.message || '请求失败'
    return Promise.reject(new Error(msg))
  }
)

export default http

// ── Auth ──────────────────────────────────────────────────────────
export const authApi = {
  login: (body) => http.post('/auth/login', body),
  register: (body) => http.post('/auth/register', body),
  me: () => http.get('/auth/me'),
  updateProfile: (body) => http.put('/auth/profile', body),
  changePassword: (body) => http.put('/auth/password', body),
  firstPassword: (body) => http.put('/auth/first-password', body),

  // Enterprise
  createEnterprise: (body) => http.post('/auth/enterprises', body),
  joinEnterprise: (body) => http.post('/auth/enterprises/join', body),
  getEnterprise: () => http.get('/auth/enterprises/mine'),
  updateSettings: (body) => http.put('/auth/enterprises/settings', body),
  getMembers: () => http.get('/auth/enterprises/members'),
  updateMemberRole: (id, body) => http.put(`/auth/enterprises/members/${id}/role`, body),
  updateMemberPerms: (id, body) => http.put(`/auth/enterprises/members/${id}/permissions`, body),
  updateManagedProjects: (id, body) => http.put(`/auth/enterprises/members/${id}/managed-projects`, body),
  removeMember: (id) => http.delete(`/auth/enterprises/members/${id}`),
  getRequests: () => http.get('/auth/enterprises/requests'),
  reviewRequest: (id, body) => http.put(`/auth/enterprises/requests/${id}`, body),
  bulkCreate: (body) => http.post('/auth/enterprises/bulk-create', body),
  uploadAvatar: (body) => http.post('/auth/avatar', body),
  updateAvatar: (avatar) => http.post('/auth/avatar', { avatar }),
}

// ── Resources ─────────────────────────────────────────────────────
export const resourceApi = {
  list: () => http.get('/resources'),
  create: (body) => http.post('/resources', body),
  update: (id, body) => http.put(`/resources/${id}`, body),
  remove: (id) => http.delete(`/resources/${id}`),
}

// ── Clients ───────────────────────────────────────────────────────
export const clientApi = {
  list: (archived = 0) => http.get(`/clients?archived=${archived}`),
  create: (body) => http.post('/clients', body),
  update: (id, body) => http.put(`/clients/${id}`, body),
  archive: (id) => http.patch(`/clients/${id}/archive`),
  unarchive: (id) => http.patch(`/clients/${id}/unarchive`),
}

// ── Projects ──────────────────────────────────────────────────────
export const projectApi = {
  list: (archived = 0) => http.get(`/projects?archived=${archived}`),
  create: (body) => http.post('/projects', body),
  update: (id, body) => http.put(`/projects/${id}`, body),
  remove: (id) => http.delete(`/projects/${id}`),
  archive: (id) => http.patch(`/projects/${id}/archive`),
  unarchive: (id) => http.patch(`/projects/${id}/unarchive`),
}

// ── Bookings ──────────────────────────────────────────────────────
export const bookingApi = {
  scheduleData: (start, end) => http.get(`/schedule-data?start=${start}&end=${end}`),
  list: (params = {}) => http.get('/bookings', { params }),
  create: (body) => http.post('/bookings', body),
  update: (id, body) => http.put(`/bookings/${id}`, body),
  remove: (id) => http.delete(`/bookings/${id}`),
  batchDelete: (body) => http.post('/bookings/batch-delete', body),
}

// ── Leave ─────────────────────────────────────────────────────────
export const leaveApi = {
  list: (start, end) => http.get(`/leave?start=${start}&end=${end}`),
  save: (body) => http.post('/leave', body),
  remove: (resourceId, date) => http.delete(`/leave/${resourceId}/${date}`),
}

// ── Timesheets ────────────────────────────────────────────────────
export const timesheetApi = {
  list: (params = {}) => http.get('/timesheets', { params }),
  save: (body) => http.post('/timesheets', body),
  remove: (id) => http.delete(`/timesheets/${id}`),
}

// ── Reports ───────────────────────────────────────────────────────
export const reportApi = {
  utilization: (start, end) => http.get(`/reports/utilization?start=${start}&end=${end}`),
  projects: (start, end) => http.get(`/reports/projects?start=${start}&end=${end}`),
  resourceDrill: (resourceId, start, end) =>
    http.get(`/reports/resource-drill?resource_id=${resourceId}&start=${start}&end=${end}`),
  projectDrill: (projectId, start, end) =>
    http.get(`/reports/project-drill?project_id=${projectId}&start=${start}&end=${end}`),
  exportExcel: (type, start, end) =>
    http.get(`/reports/export?type=${type}&start=${start}&end=${end}`, { responseType: 'blob' }),
}

// ── Enterprise (convenience alias) ──────────────────────────────
export const enterpriseApi = {
  getInfo:           () => authApi.getEnterprise(),
  updateSettings:    (body) => authApi.updateSettings(body),
  listMembers:       () => authApi.getMembers(),
  removeMember:      (id) => authApi.removeMember(id),
  invite:            (email) => http.post('/auth/enterprises/invite', { email }),
  updatePermissions: (id, body) => authApi.updateMemberPerms(id, body),
  bulkCreate:        (body) => authApi.bulkCreate(body),
  getWebhooks:       () => http.get('/auth/enterprises/webhooks'),
  updateWebhooks:    (body) => http.put('/auth/enterprises/webhooks', body),
}

// ── Permissions ───────────────────────────────────────────────────
export const permApi = {
  get: () => http.get('/permissions'),
}
