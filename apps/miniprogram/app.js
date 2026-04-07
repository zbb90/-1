const {
  PRODUCTION_API_ORIGIN,
  getApiBaseUrl,
  isDevToolsEnvironment,
} = require("./config");
const {
  logNetworkFailIfDevtools,
  maybeOfferLocalApiInDevtools,
} = require("./utils/network-help");

App({
  onLaunch() {
    this.globalData.apiBaseUrl = getApiBaseUrl();
    this.wxLogin();
  },

  globalData: {
    apiBaseUrl: "",
    token: null,
    userInfo: null,
  },

  wxLogin() {
    const savedToken = wx.getStorageSync("auth_token");
    const savedUser = wx.getStorageSync("auth_user");
    if (savedToken && savedUser) {
      this.globalData.token = savedToken;
      this.globalData.userInfo = savedUser;
      return;
    }

    wx.login({
      success: (res) => {
        if (!res.code) return;
        const apiBase = this.globalData.apiBaseUrl || getApiBaseUrl();
        wx.request({
          url: `${apiBase}/auth/wx-login`,
          method: "POST",
          data: { code: res.code },
          header: { "Content-Type": "application/json" },
          timeout: 20000,
          success: (loginRes) => {
            const data = loginRes.data || {};
            if (loginRes.statusCode === 200 && data.token) {
              this.globalData.token = data.token;
              this.globalData.userInfo = data.user;
              wx.setStorageSync("auth_token", data.token);
              wx.setStorageSync("auth_user", data.user);
            }
          },
          fail: (err) => {
            const msg = err && err.errMsg ? err.errMsg : String(err);
            console.warn("[wx-login]", msg);
            logNetworkFailIfDevtools("wx-login", err);
            maybeOfferLocalApiInDevtools(err);
            if (isDevToolsEnvironment()) {
              console.warn(
                "联调：详情→本地设置勾选「不校验合法域名」，设置页「切到本地」指向 http://127.0.0.1:3003 并本地起后台。",
              );
            }
          },
        });
      },
    });
  },

  getToken() {
    return this.globalData.token || wx.getStorageSync("auth_token") || null;
  },

  getUserInfo() {
    return this.globalData.userInfo || wx.getStorageSync("auth_user") || null;
  },

  getRequesterProfile() {
    const user = this.getUserInfo();
    if (user) {
      return {
        requesterId: user.openid,
        requesterName: user.name,
      };
    }
    let profile = wx.getStorageSync("requesterProfile");
    if (!profile || !profile.requesterId) {
      const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
      profile = {
        requesterId: `wx-local-${Date.now().toString(36)}-${suffix.toLowerCase()}`,
        requesterName: `巡店同事${suffix}`,
      };
      wx.setStorageSync("requesterProfile", profile);
    }
    return profile;
  },

  setApiOrigin(origin) {
    const nextOrigin = (origin || "").trim() || PRODUCTION_API_ORIGIN;
    wx.setStorageSync("apiOrigin", nextOrigin);
    this.globalData.apiBaseUrl = getApiBaseUrl();
    return this.globalData.apiBaseUrl;
  },

  logout() {
    this.globalData.token = null;
    this.globalData.userInfo = null;
    wx.removeStorageSync("auth_token");
    wx.removeStorageSync("auth_user");
  },
});
