const { request } = require("../../utils/request");

Page({
  data: {
    name: "",
    remark: "",
    loading: false,
  },

  handleNameInput(event) {
    this.setData({
      name: event.detail.value,
    });
  },

  handleRemarkInput(event) {
    this.setData({
      remark: event.detail.value,
    });
  },

  async handleSubmit() {
    const { name, remark, loading } = this.data;

    if (loading) {
      return;
    }

    if (!name.trim() && !remark.trim()) {
      wx.showToast({
        title: "请填写物品名称或备注",
        icon: "none",
      });
      return;
    }

    this.setData({ loading: true });

    try {
      const response = await request({
        url: "/old-item/ask",
        method: "POST",
        data: {
          name,
          remark,
        },
      });

      wx.navigateTo({
        url: `/pages/old-item/result?payload=${encodeURIComponent(
          JSON.stringify(response.data),
        )}`,
      });
    } catch (error) {
      wx.showToast({
        title: error?.message || "旧品比对失败",
        icon: "none",
      });
    } finally {
      this.setData({ loading: false });
    }
  },
});
