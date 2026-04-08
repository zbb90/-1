const { request } = require("../../utils/request");

Page({
  data: {
    categories: [
      "物料效期问题",
      "储存与离地问题",
      "交叉污染问题",
      "外购与非认可物料/器具",
      "化学品问题",
      "设备器具清洁/霉变/积垢",
      "虫害与消杀问题",
      "证照/记录/人员规范",
    ],
    categoryIndex: 0,
    storeCode: "",
    selfJudgment: "",
    description: "",
    loading: false,
  },

  handleCategoryChange(event) {
    this.setData({
      categoryIndex: Number(event.detail.value),
    });
  },

  handleStoreCodeInput(event) {
    this.setData({
      storeCode: event.detail.value,
    });
  },

  handleSelfJudgmentInput(event) {
    this.setData({
      selfJudgment: event.detail.value,
    });
  },

  handleDescriptionInput(event) {
    this.setData({
      description: event.detail.value,
    });
  },

  async handleSubmit() {
    const { categories, categoryIndex, storeCode, selfJudgment, description, loading } =
      this.data;

    if (loading) {
      return;
    }

    if (!description.trim()) {
      wx.showToast({
        title: "请先填写问题描述",
        icon: "none",
      });
      return;
    }

    this.setData({ loading: true });

    try {
      const response = await request({
        url: "/regular-question/ask",
        method: "POST",
        data: {
          storeCode,
          category: categories[categoryIndex],
          selfJudgment,
          issueTitle: categories[categoryIndex],
          description,
        },
      });

      wx.navigateTo({
        url: `/pages/regular-question/result?payload=${encodeURIComponent(
          JSON.stringify(response.data),
        )}`,
      });
    } catch (error) {
      const message = error?.message || error?.data?.message || "提交失败，请稍后重试";

      wx.showToast({
        title: message,
        icon: "none",
      });
    } finally {
      this.setData({ loading: false });
    }
  },
});
