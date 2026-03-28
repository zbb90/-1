const { request } = require("../../utils/request");

const STATUS_LABEL = {
  待处理: "待处理",
  AI已自动回答: "AI 已自动回答",
  已处理: "已处理",
  已加入知识库: "已加入知识库（规则沉淀）",
  待补充: "待补充信息",
};

Page({
  data: {
    loading: true,
    review: null,
    autoAnswer: null,
    statusLabel: "",
    errorMessage: "",
    submittingDispute: false,
    disputeSubmitted: false,
  },

  onLoad(options) {
    const id = options?.id;
    if (!id) {
      this.setData({
        loading: false,
        errorMessage: "缺少复核任务 ID。",
      });
      return;
    }

    this._taskId = id;
    this.loadDetail(id);
  },

  async loadDetail(id) {
    this.setData({ loading: true, errorMessage: "" });

    try {
      const response = await request({
        url: `/reviews/${id}`,
      });

      const review = response.data || null;
      let autoAnswer = null;

      if (review?.sourcePayload) {
        try {
          const payload = JSON.parse(review.sourcePayload);
          autoAnswer = payload?.autoAnswer ?? null;
        } catch {
          // ignore parse error
        }
      }

      this.setData({
        review,
        autoAnswer,
        statusLabel: STATUS_LABEL[review?.status] || review?.status || "",
      });
    } catch (error) {
      this.setData({
        errorMessage: error?.message || "加载复核详情失败",
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  async submitDispute() {
    const taskId = this._taskId;
    if (!taskId) return;

    this.setData({ submittingDispute: true });

    try {
      await request({
        url: "/conversations",
        method: "PATCH",
        data: { taskId },
      });

      this.setData({ disputeSubmitted: true });
      wx.showToast({ title: "已申请人工复核", icon: "success" });

      // 刷新详情
      setTimeout(() => this.loadDetail(taskId), 1200);
    } catch (error) {
      wx.showToast({
        title: error?.message || "申请失败，请稍后重试",
        icon: "none",
      });
    } finally {
      this.setData({ submittingDispute: false });
    }
  },
});
