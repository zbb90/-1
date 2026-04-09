const { request } = require("../../utils/request");
const {
  LOCAL_API_ORIGIN,
  isDevToolsEnvironment,
} = require("../../config");

Page({
  data: {
    displayName: "",
    requesterId: "",
    isLoggedIn: false,
    isSupervisor: false,
    supervisorUser: "",
    supervisorPass: "",
    showSupervisorForm: false,
    apiOriginInput: "",
    isDevTools: false,
    saving: false,
  },

  onShow() {
    this.loadProfile();
  },

  loadProfile() {
    const app = getApp();
    const user = app ? app.getUserInfo() : null;
    const localProfile = wx.getStorageSync("requesterProfile") || {};
    const supervisorAuth = wx.getStorageSync("supervisorAuth") || null;
    const savedOrigin = wx.getStorageSync("apiOrigin") || "";
    const isDevTools = isDevToolsEnvironment();
    const isLoggedIn = Boolean(user && user.openid);

    this.setData({
      displayName: isLoggedIn ? user.name || "" : localProfile.requesterName || "",
      requesterId: isLoggedIn ? user.openid : localProfile.requesterId || "",
      isLoggedIn,
      isSupervisor: Boolean(supervisorAuth && supervisorAuth.user),
      showSupervisorForm: false,
      supervisorUser: "",
      supervisorPass: "",
      apiOriginInput: savedOrigin,
      isDevTools,
    });
  },

  handleNameInput(e) {
    this.setData({ displayName: e.detail.value });
  },

  async saveName() {
    const name = this.data.displayName.trim();
    if (!name) {
      wx.showToast({ title: "请输入你的真实姓名", icon: "none" });
      return;
    }
    if (this.data.saving) return;
    this.setData({ saving: true });

    try {
      if (this.data.isLoggedIn) {
        const res = await request({
          url: "/auth/update-profile",
          method: "POST",
          data: { name },
        });
        if (res.token && res.user) {
          const app = getApp();
          app.globalData.token = res.token;
          app.globalData.userInfo = res.user;
          wx.setStorageSync("auth_token", res.token);
          wx.setStorageSync("auth_user", res.user);
        }
      }

      const profile = wx.getStorageSync("requesterProfile") || {};
      profile.requesterName = name;
      wx.setStorageSync("requesterProfile", profile);

      wx.showToast({ title: "姓名已保存", icon: "success" });
    } catch {
      wx.showToast({ title: "保存失败，请重试", icon: "none" });
    } finally {
      this.setData({ saving: false });
    }
  },

  toggleSupervisorForm() {
    this.setData({ showSupervisorForm: !this.data.showSupervisorForm });
  },

  handleSupervisorUserInput(e) {
    this.setData({ supervisorUser: e.detail.value });
  },

  handleSupervisorPassInput(e) {
    this.setData({ supervisorPass: e.detail.value });
  },

  saveSupervisorAuth() {
    const user = this.data.supervisorUser.trim();
    const pass = this.data.supervisorPass.trim();
    if (!user || !pass) {
      wx.showToast({ title: "账号和密码不能为空", icon: "none" });
      return;
    }
    wx.setStorageSync("supervisorAuth", { user, pass });
    this.setData({
      isSupervisor: true,
      showSupervisorForm: false,
      supervisorUser: "",
      supervisorPass: "",
    });
    wx.showToast({ title: "主管模式已开启", icon: "success" });
  },

  exitSupervisorMode() {
    wx.removeStorageSync("supervisorAuth");
    this.setData({ isSupervisor: false, showSupervisorForm: false });
    wx.showToast({ title: "已退出主管模式", icon: "success" });
  },

  handleApiOriginInput(e) {
    this.setData({ apiOriginInput: e.detail.value });
  },

  saveApiOrigin() {
    const origin = this.data.apiOriginInput.trim().replace(/\/+$/, "");
    const app = getApp();
    if (app && typeof app.setApiOrigin === "function") {
      app.setApiOrigin(origin || "");
    } else {
      wx.setStorageSync("apiOrigin", origin);
    }
    wx.showToast({
      title: origin ? "已切换接口地址" : "已恢复默认地址",
      icon: "success",
    });
  },

  resetApiOrigin() {
    wx.removeStorageSync("apiOrigin");
    if (getApp() && typeof getApp().setApiOrigin === "function") {
      getApp().setApiOrigin("");
    }
    this.setData({ apiOriginInput: "" });
    wx.showToast({ title: "已恢复默认线上地址", icon: "success" });
  },

  useLocalOrigin() {
    const app = getApp();
    if (app && typeof app.setApiOrigin === "function") {
      app.setApiOrigin(LOCAL_API_ORIGIN);
    } else {
      wx.setStorageSync("apiOrigin", LOCAL_API_ORIGIN);
    }
    this.setData({ apiOriginInput: LOCAL_API_ORIGIN });
    wx.showToast({ title: "已切换到本地服务", icon: "none" });
  },
});
