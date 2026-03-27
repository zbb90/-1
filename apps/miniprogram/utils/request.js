function buildErrorMessage(payload, fallbackMessage) {
  if (typeof payload === "string" && payload.trim()) {
    return payload;
  }

  if (payload && typeof payload.message === "string" && payload.message.trim()) {
    return payload.message;
  }

  if (payload && payload.data && typeof payload.data.message === "string") {
    return payload.data.message;
  }

  return fallbackMessage;
}

function attachRequesterPayload(data, requesterProfile) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return data;
  }

  return {
    ...data,
    requesterId: requesterProfile?.requesterId || data.requesterId,
    requesterName: requesterProfile?.requesterName || data.requesterName,
  };
}

function request({ url, method = "GET", data, header = {} }) {
  return new Promise((resolve, reject) => {
    const app = getApp();
    const apiBaseUrl = app?.globalData?.apiBaseUrl || "";
    const requesterProfile =
      app && typeof app.getRequesterProfile === "function"
        ? app.getRequesterProfile()
        : app?.globalData?.requesterProfile;
    const requesterHeader = {
      ...header,
    };

    if (requesterProfile?.requesterId) {
      requesterHeader["x-requester-id"] = requesterProfile.requesterId;
    }

    wx.request({
      url: `${apiBaseUrl}${url}`,
      method,
      data: attachRequesterPayload(data, requesterProfile),
      header: requesterHeader,
      timeout: 10000,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
          return;
        }
        reject({
          ...res.data,
          message: buildErrorMessage(
            res.data,
            `请求失败（${res.statusCode}），请稍后重试`,
          ),
          statusCode: res.statusCode,
        });
      },
      fail: (error) => {
        reject({
          ...error,
          message: "网络请求失败，请检查接口地址或网络连接",
        });
      },
    });
  });
}

module.exports = {
  request,
};
