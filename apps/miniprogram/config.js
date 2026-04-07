const PRODUCTION_API_ORIGIN = "https://admin.jihe.fun";
const LOCAL_API_ORIGIN = "http://127.0.0.1:3003";
const LEGACY_PRODUCTION_ORIGINS = new Set([
  "https://1-admin-seven.vercel.app",
  "https://1-admin-q2iik9pbe-zbbs-projects-2778e2e9.vercel.app",
  "https://1-admin-6jtveglc9-zbbs-projects-2778e2e9.vercel.app",
]);

function isDevToolsEnvironment() {
  try {
    const info = wx.getAppBaseInfo
      ? wx.getAppBaseInfo()
      : wx.getSystemInfoSync();
    return info.platform === "devtools";
  } catch (e) {
    return false;
  }
}

function getDefaultOrigin() {
  return PRODUCTION_API_ORIGIN;
}

function getApiBaseUrl() {
  const savedOrigin = (wx.getStorageSync("apiOrigin") || "")
    .trim()
    .replace(/\/+$/, "");
  const normalizedSavedOrigin = LEGACY_PRODUCTION_ORIGINS.has(savedOrigin)
    ? ""
    : savedOrigin;
  const origin = normalizedSavedOrigin || getDefaultOrigin();
  return `${origin}/api`;
}

module.exports = {
  PRODUCTION_API_ORIGIN,
  LOCAL_API_ORIGIN,
  isDevToolsEnvironment,
  getApiBaseUrl,
};
