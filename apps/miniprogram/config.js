const PRODUCTION_API_ORIGIN = "https://1-admin-seven.vercel.app";
const LOCAL_API_ORIGIN = "http://127.0.0.1:3003";

function isDevToolsEnvironment() {
  try {
    const info = wx.getSystemInfoSync();
    return info.platform === "devtools";
  } catch {
    return false;
  }
}

function getDefaultOrigin() {
  return PRODUCTION_API_ORIGIN;
}

function getApiBaseUrl() {
  const savedOrigin = (wx.getStorageSync("apiOrigin") || "").trim().replace(/\/+$/, "");
  const origin = savedOrigin || getDefaultOrigin();
  return `${origin}/api`;
}

module.exports = {
  PRODUCTION_API_ORIGIN,
  LOCAL_API_ORIGIN,
  isDevToolsEnvironment,
  getApiBaseUrl,
};
