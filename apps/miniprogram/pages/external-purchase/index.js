const { request } = require("../../utils/request");

Page({
  data: {
    name: "",
    description: "",
    loading: false,
  },

  handleNameInput(event) {
    this.setData({
      name: event.detail.value,
    });
  },

  handleDescriptionInput(event) {
    this.setData({
      description: event.detail.value,
    });
  },

  async handleSubmit() {
    const { name, description, loading } = this.data;

    if (loading) {
      return;
    }

    if (!name.trim() && !description.trim()) {
      wx.showToast({
        title: "请填写物品名称或描述",
        icon: "none",
      });
      return;
    }

    this.setData({ loading: true });

    try {
      const response = await request({
        url: "/external-purchase/ask",
        method: "POST",
        data: {
          name,
          description,
        },
      });

      wx.navigateTo({
        url: `/pages/external-purchase/result?payload=${encodeURIComponent(
          JSON.stringify(response.data),
        )}`,
      });
    } catch (error) {
      wx.showToast({
        title: error?.message || "外购查询失败",
        icon: "none",
      });
    } finally {
      this.setData({ loading: false });
    }
  },
});
