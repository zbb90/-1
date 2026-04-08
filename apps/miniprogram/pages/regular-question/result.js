const { request } = require("../../utils/request");

Page({
  data: {
    matched: false,
    rejectReason: "",
    answer: null,
    candidates: [],
    reviewTask: null,
    requestSnapshot: null,
    isOperation: false,
    statusText: "无依据",
    scoreText: "待人工确认",
    submittingReview: false,
  },

  onLoad(options) {
    const payload = options?.payload;
    if (!payload) {
      return;
    }

    try {
      const parsed = JSON.parse(decodeURIComponent(payload));
      const answer = parsed.answer || null;
      const isOperation = answer?.category === "操作标准";
      const statusText = isOperation
        ? "已命中操作资料"
        : answer?.shouldDeduct || "无依据";
      const scoreText = answer?.deductScore
        ? `${answer.deductScore}｜${answer.clauseNo || "无条款编号"}`
        : "待人工确认";

      this.setData({
        matched: parsed.matched,
        rejectReason: parsed.rejectReason || "",
        answer,
        candidates: parsed.candidates || [],
        reviewTask: parsed.reviewTask || null,
        requestSnapshot: parsed.requestSnapshot || null,
        isOperation,
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

  async submitManualReview() {
    if (this.data.submittingReview) {
      return;
    }

    if (this.data.reviewTask?.id) {
      this.goToReviewDetail();
      return;
    }

    if (!this.data.requestSnapshot) {
      wx.showToast({
        title: "缺少原始问题信息，请返回重新提交",
        icon: "none",
      });
      return;
    }

    this.setData({ submittingReview: true });

    try {
      const response = await request({
        url: "/regular-question/review",
        method: "POST",
        data: {
          ...this.data.requestSnapshot,
          answer: this.data.answer,
          candidates: this.data.candidates,
        },
      });

      const reviewTask = response?.data?.reviewTask || null;
      if (!reviewTask?.id) {
        throw new Error("人工复核任务创建失败");
      }

      this.setData({ reviewTask });

      wx.showToast({
        title: "已提交人工复核",
        icon: "success",
      });

      setTimeout(() => {
        wx.navigateTo({
          url: `/pages/my-reviews/detail?id=${reviewTask.id}`,
        });
      }, 300);
    } catch (error) {
      wx.showToast({
        title: error?.message || "提交人工复核失败",
        icon: "none",
      });
    } finally {
      this.setData({ submittingReview: false });
    }
  },
});
