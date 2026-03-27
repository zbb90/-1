const DEFAULT_API_ORIGIN = "http://127.0.0.1:3003";

function normalizeApiOrigin(origin) {
  const normalized = (origin || "").trim().replace(/\/+$/, "");
  return normalized || DEFAULT_API_ORIGIN;
}

function getApiBaseUrl() {
  const savedOrigin = wx.getStorageSync("apiOrigin");
  return `${normalizeApiOrigin(savedOrigin)}/api`;
}

module.exports = {
  DEFAULT_API_ORIGIN,
  getApiBaseUrl,
};
