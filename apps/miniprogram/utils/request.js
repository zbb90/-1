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

/**
 * 与 App#getRequesterProfile 对齐；在 getApp 尚未就绪时仍能从 storage 生成 x-requester-id，避免 GET /reviews 等 401。
 */
function getRequesterProfileForRequest() {
  try {
    const app = getApp();
    if (app && typeof app.getRequesterProfile === "function") {
      const p = app.getRequesterProfile();
      if (p && p.requesterId) {
        return p;
      }
    }
  } catch (e) {
    // App 未初始化时 getApp 可能不可用
  }

  const user = wx.getStorageSync("auth_user");
  if (user && user.openid) {
    return {
      requesterId: user.openid,
      requesterName: user.name,
    };
  }

  let profile = wx.getStorageSync("requesterProfile");
  if (profile && profile.requesterId) {
    return profile;
  }

  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  profile = {
    requesterId: `wx-local-${Date.now().toString(36)}-${suffix.toLowerCase()}`,
    requesterName: `巡店同事${suffix}`,
  };
  wx.setStorageSync("requesterProfile", profile);
  return profile;
}

const { getApiBaseUrl } = require("../config");
const {
  describeWxRequestFail,
  logNetworkFailIfDevtools,
  maybeOfferLocalApiInDevtools,
} = require("./network-help");

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
    const apiBaseUrl =
      (app && app.globalData && app.globalData.apiBaseUrl) || getApiBaseUrl();
    const requesterProfile = getRequesterProfileForRequest();

    const reqHeader = { ...header };

    const token = app && typeof app.getToken === "function" ? app.getToken() : null;
    if (token) {
      reqHeader["Authorization"] = "Bearer " + token;
    }

    if (requesterProfile?.requesterId && !reqHeader["x-requester-id"]) {
      reqHeader["x-requester-id"] = requesterProfile.requesterId;
    }

    wx.request({
      url: `${apiBaseUrl}${url}`,
      method,
      data: attachRequesterPayload(data, requesterProfile),
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
