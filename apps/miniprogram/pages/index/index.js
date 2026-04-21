Page({
  data: {
    displayName: "",
    avatarLetter: "?",
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

    const displayName = profile.requesterName || "未设置昵称";
    const trimmed = String(displayName).trim();
    const avatarLetter = trimmed ? trimmed.charAt(0) : "?";

    this.setData({
      displayName,
      avatarLetter,
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

  goToMyReviews() {
    wx.navigateTo({ url: "/pages/my-reviews/index" });
  },

  showComingSoon(event) {
    const feature =
      (event &&
        event.currentTarget &&
        event.currentTarget.dataset &&
        event.currentTarget.dataset.feature) ||
      "该功能";
    wx.showToast({
      title: `${feature}暂未开放，敬请期待`,
      icon: "none",
      duration: 2000,
    });
  },
});
