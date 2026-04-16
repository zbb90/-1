const { request } = require("../../utils/request");

const POLL_INTERVAL = 15000;
const MAX_SILENT_FAILURES = 3;

const STATUS_LABEL = {
  待处理: "待处理",
  AI已自动回答: "AI 已自动回答",
  已处理: "已处理",
  已加入知识库: "已加入知识库（规则沉淀）",
  待补充: "待补充信息",
};

function isReplyReady(review) {
  if (!review) return false;
  return (
    review.status === "已处理" ||
    review.status === "已加入知识库" ||
    review.status === "待补充" ||
    Boolean((review.finalConclusion || "").trim()) ||
    Boolean((review.finalExplanation || "").trim())
  );
}

function hasUnreadReply(review) {
  if (!isReplyReady(review) || !review.replyPublishedAt) return false;
  const replyAt = new Date(review.replyPublishedAt).getTime();
  const viewedAt = review.requesterLastViewedAt
    ? new Date(review.requesterLastViewedAt).getTime()
    : 0;
  if (!Number.isFinite(replyAt)) return false;
  return !Number.isFinite(viewedAt) || replyAt > viewedAt;
}

Page({
  data: {
    loading: true,
    review: null,
    autoAnswer: null,
    statusLabel: "",
    errorMessage: "",
    submittingDispute: false,
    disputeSubmitted: false,
    hasReply: false,
    hasUnreadReply: false,
    isSupervisor: false,
    submittingReply: false,
    statusOptions: ["已处理", "待补充", "已加入知识库"],
    statusIndex: 0,
    processorInput: "",
    finalConclusionInput: "",
    finalScoreInput: "",
    finalClauseInput: "",
    finalExplanationInput: "",
    pollingPaused: false,
    pollHint: "",
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
    const supervisorAuth = wx.getStorageSync("supervisorAuth") || null;
    this._isSupervisor = Boolean(supervisorAuth && supervisorAuth.user);
    this.setData({
      isSupervisor: this._isSupervisor,
    });
    this.loadDetail(id);
  },

  onShow() {
    this.startPolling();
  },

  onHide() {
    this.stopPolling();
  },

  onUnload() {
    this.stopPolling();
  },

  startPolling() {
    this.stopPolling();
    this._silentFailureCount = 0;
    this._pollingPaused = false;
    this.setData({ pollingPaused: false, pollHint: "" });
    this._pollTimer = setInterval(() => {
      if (this._pollingPaused) return;
      if (this._taskId) {
        this.loadDetail(this._taskId, { silent: true });
      }
    }, POLL_INTERVAL);
  },

  stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  },

  pausePolling(error, options = {}) {
    const { showToast = false } = options;
    this._pollingPaused = true;
    this.stopPolling();
    const requestUrl = error?.requestUrl || "";
    const baseMessage =
      error?.category === "tls_certificate"
        ? "HTTPS 证书校验失败，已暂停自动刷新。"
        : "网络连续异常，已暂停自动刷新。";
    const pollHint = requestUrl ? `${baseMessage}\n当前地址：${requestUrl}` : baseMessage;
    this.setData({ pollingPaused: true, pollHint });
    if (showToast) {
      wx.showToast({
        title: error?.message || "已暂停自动刷新，请稍后重试",
        icon: "none",
      });
    }
  },

  async loadDetail(id, options = {}) {
    const { silent = false } = options;
    const isSupervisor = Boolean(this._isSupervisor || this.data.isSupervisor);
    if (!silent) {
      this.setData({ loading: true, errorMessage: "" });
    }

    try {
      const response = await request({
        url: `/reviews/${id}`,
        adminAuth: isSupervisor,
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

      const hasReply = isReplyReady(review);
      const unreadReply = hasUnreadReply(review);
      const prevHasReply = this.data.hasReply;

      this.setData({
        review,
        autoAnswer,
        statusLabel: STATUS_LABEL[review?.status] || review?.status || "",
        hasReply,
        hasUnreadReply: unreadReply,
        statusIndex: Math.max(
          0,
          this.data.statusOptions.indexOf(review?.status || "已处理"),
        ),
        processorInput: review?.processor || "",
        finalConclusionInput: review?.finalConclusion || "",
        finalScoreInput: review?.finalScore || "",
        finalClauseInput: review?.finalClause || "",
        finalExplanationInput: review?.finalExplanation || "",
      });
      this._silentFailureCount = 0;
      if (this.data.pollingPaused) {
        this.setData({ pollingPaused: false, pollHint: "" });
      }

      if (!isSupervisor && unreadReply) {
        this.markRequesterRead(id);
      }

      if (silent && !isSupervisor && !prevHasReply && hasReply) {
        wx.vibrateShort({ type: "medium" });
        wx.showModal({
          title: "主管已回复",
          content: "当前问题已得到主管处理，页面已刷新到最新结果。",
          showCancel: false,
          confirmText: "查看结果",
        });
      }
    } catch (error) {
      if (silent) {
        this._silentFailureCount = (this._silentFailureCount || 0) + 1;
      }

      if (error?.category === "tls_certificate") {
        this.pausePolling(error, { showToast: !silent });
      } else if (silent && this._silentFailureCount >= MAX_SILENT_FAILURES) {
        this.pausePolling(error, { showToast: true });
      }

      if (!silent) {
        this.setData({
          errorMessage: error?.message || "加载复核详情失败",
        });
      }
    } finally {
      if (!silent) {
        this.setData({ loading: false });
      }
    }
  },

  retryLoad() {
    if (!this._taskId) return;
    this.setData({ errorMessage: "" });
    this.startPolling();
    this.loadDetail(this._taskId);
  },

  async markRequesterRead(id) {
    try {
      await request({
        url: `/reviews/${id}`,
        method: "PATCH",
        data: { markRequesterRead: true },
      });

      if (this.data.review) {
        this.setData({
          hasUnreadReply: false,
          review: {
            ...this.data.review,
            requesterLastViewedAt: new Date().toISOString(),
          },
        });
      }
    } catch {
      // ignore read mark failure, next refresh will retry
    }
  },

  handleStatusChange(e) {
    this.setData({
      statusIndex: Number(e.detail.value || 0),
    });
  },

  handleProcessorInput(e) {
    this.setData({ processorInput: e.detail.value });
  },

  handleConclusionInput(e) {
    this.setData({ finalConclusionInput: e.detail.value });
  },

  handleScoreInput(e) {
    this.setData({ finalScoreInput: e.detail.value });
  },

  handleClauseInput(e) {
    this.setData({ finalClauseInput: e.detail.value });
  },

  handleExplanationInput(e) {
    this.setData({ finalExplanationInput: e.detail.value });
  },

  async submitSupervisorReply() {
    const taskId = this._taskId;
    if (!taskId || !this.data.isSupervisor || this.data.submittingReply) return;

    const finalConclusion = this.data.finalConclusionInput.trim();
    const finalExplanation = this.data.finalExplanationInput.trim();
    if (!finalConclusion && !finalExplanation) {
      wx.showToast({
        title: "请至少填写结论或回复内容",
        icon: "none",
      });
      return;
    }

    this.setData({ submittingReply: true });
    try {
      await request({
        url: `/reviews/${taskId}`,
        method: "PATCH",
        adminAuth: true,
        data: {
          status: this.data.statusOptions[this.data.statusIndex] || "已处理",
          processor: this.data.processorInput.trim(),
          finalConclusion,
          finalScore: this.data.finalScoreInput.trim(),
          finalClause: this.data.finalClauseInput.trim(),
          finalExplanation,
        },
      });

      wx.showToast({
        title: "已回复专员",
        icon: "success",
      });
      this.loadDetail(taskId);
    } catch (error) {
      wx.showToast({
        title: error?.message || "回复失败，请稍后重试",
        icon: "none",
      });
    } finally {
      this.setData({ submittingReply: false });
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
