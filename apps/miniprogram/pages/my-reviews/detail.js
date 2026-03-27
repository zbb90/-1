const { request } = require("../../utils/request");

Page({
  data: {
    loading: true,
    review: null,
    errorMessage: "",
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

    this.loadDetail(id);
  },

  async loadDetail(id) {
    this.setData({ loading: true, errorMessage: "" });

    try {
      const response = await request({
        url: `/reviews/${id}`,
      });

      this.setData({
        review: response.data || null,
      });
    } catch (error) {
      this.setData({
        errorMessage: error?.message || "加载复核详情失败",
      });
    } finally {
      this.setData({ loading: false });
    }
  },
});
