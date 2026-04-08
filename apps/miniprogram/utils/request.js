function buildErrorMessage(payload, fallbackMessage) {
  if (typeof payload === "string" && payload.trim()) {
    return payload;
  }

  if (payload && typeof payload.message === "string" && payload.message.trim()) {
    return payload.message;
  }

  if (payload && typeof payload.error === "string" && payload.error.trim()) {
    return payload.error;
  }

  if (payload && payload.data && typeof payload.data.message === "string") {
    return payload.data.message;
  }

  return fallbackMessage;
}

const { getApiBaseUrl } = require("../config");
const {
  describeWxRequestFail,
  logNetworkFailIfDevtools,
  maybeOfferLocalApiInDevtools,
} = require("./network-help");

function request({ url, method = "GET", data, header = {} }) {
  return new Promise((resolve, reject) => {
    const app = getApp();
    const apiBaseUrl =
      (app && app.globalData && app.globalData.apiBaseUrl) || getApiBaseUrl();
    const reqHeader = { ...header };

    const token = app && typeof app.getToken === "function" ? app.getToken() : null;
    if (token) {
      reqHeader["Authorization"] = "Bearer " + token;
    }

    wx.request({
      url: `${apiBaseUrl}${url}`,
      method,
      data,
      header: reqHeader,
      timeout: 30000,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
          return;
        }

        if (res.statusCode === 401 || res.statusCode === 403) {
          if (app && typeof app.wxLogin === "function") {
            app.logout();
            app.wxLogin();
          }
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
        logNetworkFailIfDevtools("request", error);
        maybeOfferLocalApiInDevtools(error);
        const { shortMessage } = describeWxRequestFail(error);
        reject({
          ...error,
          message: shortMessage,
        });
      },
    });
  });
}

module.exports = {
  request,
};
