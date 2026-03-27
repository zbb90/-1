Page({
  data: {
    matched: false,
    rejectReason: "",
    answer: null,
    candidates: [],
    reviewTask: null,
  },

  onLoad(options) {
    const payload = options?.payload;
    if (!payload) {
      return;
    }

    try {
      const parsed = JSON.parse(decodeURIComponent(payload));
      this.setData({
        matched: parsed.matched,
        rejectReason: parsed.rejectReason || "",
        answer: parsed.answer || null,
        candidates: parsed.candidates || [],
        reviewTask: parsed.reviewTask || null,
      });
    } catch (error) {
      this.setData({
        rejectReason: "结果解析失败，请返回重新提交。",
      });
    }
  },

  goBack() {
    wx.navigateBack();
  },

  goToReviewDetail() {
    const reviewId = this.data.reviewTask?.id;
    if (!reviewId) {
      return;
    }

    wx.navigateTo({
      url: `/pages/my-reviews/detail?id=${reviewId}`,
    });
  },
});
