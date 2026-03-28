Page({
  data: {
    displayName: "",
    requesterId: "",
    isSupervisor: false,
  },

  onShow() {
    const app = getApp();
    const profile =
      (app && typeof app.getRequesterProfile === "function"
        ? app.getRequesterProfile()
        : wx.getStorageSync("requesterProfile")) || {};

    const supervisorAuth = wx.getStorageSync("supervisorAuth");
    const isSupervisor = Boolean(supervisorAuth && supervisorAuth.user);

    this.setData({
      displayName: profile.requesterName || "未设置昵称",
      requesterId: profile.requesterId || "",
      isSupervisor,
    });
  },

  goToSettings() {
    wx.navigateTo({ url: "/pages/settings/index" });
  },

  goToRegularQuestion() {
    wx.navigateTo({ url: "/pages/regular-question/index" });
  },

  goToOldItem() {
    wx.navigateTo({ url: "/pages/old-item/index" });
  },

  goToExternalPurchase() {
    wx.navigateTo({ url: "/pages/external-purchase/index" });
  },

  goToMyReviews() {
    wx.navigateTo({ url: "/pages/my-reviews/index" });
  },
});
