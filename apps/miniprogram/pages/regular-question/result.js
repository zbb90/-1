Page({
  data: {
    matched: false,
    rejectReason: "",
    answer: null,
    candidates: [],
    reviewTask: null,
    statusText: "无依据",
    scoreText: "待人工确认",
  },

  onLoad(options) {
    const payload = options?.payload;
    if (!payload) {
      return;
    }

    try {
      const parsed = JSON.parse(decodeURIComponent(payload));
      const answer = parsed.answer || null;
      const statusText = answer?.shouldDeduct || "无依据";
      const scoreText = answer?.deductScore
        ? `${answer.deductScore}｜${answer.clauseNo || "无条款编号"}`
        : "待人工确认";

      this.setData({
        matched: parsed.matched,
        rejectReason: parsed.rejectReason || "",
        answer,
        candidates: parsed.candidates || [],
        reviewTask: parsed.reviewTask || null,
        statusText,
        scoreText,
      });
    } catch (error) {
      this.setData({
        matched: false,
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
