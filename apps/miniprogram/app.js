const { DEFAULT_API_ORIGIN, getApiBaseUrl } = require("./config");

function createRequesterProfile() {
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return {
    requesterId: `wx-local-${Date.now().toString(36)}-${suffix.toLowerCase()}`,
    requesterName: `巡店同事${suffix}`,
  };
}

App({
  onLaunch() {
    this.ensureRequesterProfile();
  },

  globalData: {
    apiBaseUrl: getApiBaseUrl(),
    requesterProfile: null,
  },

  ensureRequesterProfile() {
    let profile = wx.getStorageSync("requesterProfile");

    if (!profile || !profile.requesterId) {
      profile = createRequesterProfile();
      wx.setStorageSync("requesterProfile", profile);
    }

    this.globalData.requesterProfile = profile;
    return profile;
  },

  getRequesterProfile() {
    return this.globalData.requesterProfile || this.ensureRequesterProfile();
  },

  setApiOrigin(origin) {
    const nextOrigin = (origin || "").trim() || DEFAULT_API_ORIGIN;
    wx.setStorageSync("apiOrigin", nextOrigin);
    this.globalData.apiBaseUrl = getApiBaseUrl();
    return this.globalData.apiBaseUrl;
  },
});
