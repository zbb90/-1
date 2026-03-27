const { request } = require("../../utils/request");

const TABS = ["处理中", "已处理", "待补充"];

Page({
  data: {
    tabs: TABS,
    activeTab: "处理中",
    loading: false,
    reviews: [],
    filteredReviews: [],
  },

  onShow() {
    this.loadReviews();
  },

  async loadReviews() {
    this.setData({ loading: true });

    try {
      const response = await request({
        url: "/reviews",
      });

      const reviews = response.data || [];
      this.setData({ reviews });
      this.applyFilter(this.data.activeTab, reviews);
    } catch (error) {
      wx.showToast({
        title: error?.message || "加载复核列表失败",
        icon: "none",
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  handleTabChange(event) {
    const { tab } = event.currentTarget.dataset;
    this.applyFilter(tab, this.data.reviews);
  },

  applyFilter(tab, reviews) {
    const filteredReviews = reviews.filter((item) => {
      if (tab === "处理中") {
        return item.status === "待处理";
      }
      if (tab === "已处理") {
        return item.status === "已处理" || item.status === "已加入知识库";
      }
      if (tab === "待补充") {
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
