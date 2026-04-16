const { request } = require("../../utils/request");

const POLL_INTERVAL = 15000;
const MAX_SILENT_FAILURES = 3;
const SPECIALIST_TABS = [
  { key: "processing", label: "处理中" },
  { key: "replied", label: "主管已回复" },
  { key: "needMore", label: "待补充" },
];
const SUPERVISOR_TABS = [
  { key: "all", label: "全部问题" },
  { key: "processing", label: "处理中" },
  { key: "replied", label: "主管已回复" },
  { key: "needMore", label: "待补充" },
];

function isReplyReady(item) {
  if (!item) return false;
  return (
    item.status === "已处理" ||
    item.status === "已加入知识库" ||
    item.status === "待补充" ||
    Boolean((item.finalConclusion || "").trim()) ||
    Boolean((item.finalExplanation || "").trim())
  );
}

function hasUnreadReply(item) {
  if (!isReplyReady(item) || !item.replyPublishedAt) return false;
  const replyAt = new Date(item.replyPublishedAt).getTime();
  const viewedAt = item.requesterLastViewedAt
    ? new Date(item.requesterLastViewedAt).getTime()
    : 0;
  if (!Number.isFinite(replyAt)) return false;
  return !Number.isFinite(viewedAt) || replyAt > viewedAt;
}

function normalizeReview(item) {
  const unread = hasUnreadReply(item);
  const ready = isReplyReady(item);
  return {
    ...item,
    hasReply: ready,
    hasUnreadReply: unread,
    displayStatus: unread ? "主管已回复" : item.status,
    replyPreview: (item.finalExplanation || item.finalConclusion || "").trim(),
  };
}

function compareReviews(left, right) {
  if (left.hasUnreadReply !== right.hasUnreadReply) {
    return left.hasUnreadReply ? -1 : 1;
  }
  if (left.hasReply !== right.hasReply) {
    return left.hasReply ? -1 : 1;
  }
  return String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
}

Page({
  data: {
    tabs: SPECIALIST_TABS,
    activeTab: "processing",
    loading: false,
    reviews: [],
    filteredReviews: [],
    unreadReplyCount: 0,
    isSupervisor: false,
    pollingPaused: false,
    pollHint: "",
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
    const supervisorAuth = wx.getStorageSync("supervisorAuth") || null;
    this._isSupervisor = Boolean(supervisorAuth && supervisorAuth.user);
    this._activeTab = this._isSupervisor ? "all" : "processing";
    this.setData({
      isSupervisor: this._isSupervisor,
      tabs: this._isSupervisor ? SUPERVISOR_TABS : SPECIALIST_TABS,
      activeTab: this._activeTab,
      pollingPaused: false,
      pollHint: "",
    });
    this.loadReviews({ activeTab: this._activeTab });
    this._pollTimer = setInterval(() => {
      if (this._pollingPaused) return;
      this.loadReviews({ silent: true, activeTab: this._activeTab });
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

  async loadReviews(options = {}) {
    const { silent = false, activeTab } = options;
    const isSupervisor = Boolean(this._isSupervisor || this.data.isSupervisor);
    const currentTab = activeTab || this._activeTab || this.data.activeTab;
    if (!silent) {
      this.setData({ loading: true });
    }

    try {
      const response = await request({
        url: "/reviews",
        adminAuth: isSupervisor,
      });

      const reviews = (response.data || []).map(normalizeReview).sort(compareReviews);
      const unreadReplyCount = isSupervisor
        ? 0
        : reviews.filter((item) => item.hasUnreadReply).length;
      const prevUnreadReplyCount = this.data.unreadReplyCount || 0;

      this.setData({ reviews, unreadReplyCount });
      this.applyFilter(currentTab, reviews);
      this._silentFailureCount = 0;
      if (this.data.pollingPaused) {
        this.setData({ pollingPaused: false, pollHint: "" });
      }

      if (silent && this._loadedOnce && unreadReplyCount > prevUnreadReplyCount) {
        wx.vibrateShort({ type: "light" });
        wx.showToast({
          title: "主管有新回复",
          icon: "none",
        });
      }

      this._loadedOnce = true;
    } catch (error) {
      if (silent) {
        this._silentFailureCount = (this._silentFailureCount || 0) + 1;
      }

      if (error?.category === "tls_certificate") {
        this.pausePolling(error, { showToast: !silent });
      } else if (silent && this._silentFailureCount >= MAX_SILENT_FAILURES) {
        this.pausePolling(error, { showToast: true });
      }

      if (!silent && error?.category !== "tls_certificate") {
        wx.showToast({
          title: error?.message || "加载复核列表失败",
          icon: "none",
        });
      }
    } finally {
      if (!silent) {
        this.setData({ loading: false });
      }
    }
  },

  retryLoad() {
    this.startPolling();
  },

  handleTabChange(event) {
    const { tab } = event.currentTarget.dataset;
    this._activeTab = tab;
    this.applyFilter(tab, this.data.reviews);
  },

  applyFilter(tab, reviews) {
    const filteredReviews = reviews.filter((item) => {
      if (tab === "all") {
        return true;
      }
      if (tab === "processing") {
        return !item.hasReply && (item.status === "待处理" || item.status === "AI已自动回答");
      }
      if (tab === "replied") {
        return item.hasReply && item.status !== "待补充";
      }
      if (tab === "needMore") {
        return item.status === "待补充";
      }
      return true;
    });

    this.setData({
      activeTab: tab,
      filteredReviews,
    });
  },

  goToDetail(event) {
    const { id } = event.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/my-reviews/detail?id=${id}`,
    });
  },
});
