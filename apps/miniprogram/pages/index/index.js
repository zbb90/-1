Page({
  goToRegularQuestion() {
    wx.navigateTo({
      url: "/pages/regular-question/index",
    });
  },

  goToOldItem() {
    wx.navigateTo({
      url: "/pages/old-item/index",
    });
  },

  goToExternalPurchase() {
    wx.navigateTo({
      url: "/pages/external-purchase/index",
    });
  },

  goToMyReviews() {
    wx.navigateTo({
      url: "/pages/my-reviews/index",
    });
  },
});
