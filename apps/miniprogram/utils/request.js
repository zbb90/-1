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

function encodeBasicAuth(value) {
  const bytes = new Uint8Array(
    String(value)
      .split("")
      .map((char) => char.charCodeAt(0)),
  );
  return wx.arrayBufferToBase64(bytes.buffer);
}

function resolveAdminAuth(adminAuth) {
  if (!adminAuth) {
    return null;
  }

  if (adminAuth === true) {
    return wx.getStorageSync("supervisorAuth") || null;
  }

  if (typeof adminAuth === "object" && adminAuth.user && adminAuth.pass) {
    return adminAuth;
  }

  return null;
}

function sendRequest({ app, apiBaseUrl, url, method, data, header, adminAuth }) {
  return new Promise((resolve, reject) => {
    const reqHeader = { ...header };

    const token = app && typeof app.getToken === "function" ? app.getToken() : null;
    if (token) {
      reqHeader["Authorization"] = "Bearer " + token;
    }

    const adminCreds = resolveAdminAuth(adminAuth);
    if (adminCreds && adminCreds.user && adminCreds.pass) {
      reqHeader["Authorization"] =
        "Basic " + encodeBasicAuth(`${adminCreds.user}:${adminCreds.pass}`);
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

        reject({
          ...res.data,
          message: buildErrorMessage(
            res.data,
            `请求失败（${res.statusCode}），请稍后重试`,
          ),
          statusCode: res.statusCode,
          requiresRelogin:
            (res.statusCode === 401 || res.statusCode === 403) && !adminCreds,
        });
      },
      fail: (error) => {
        logNetworkFailIfDevtools("request", error);
        maybeOfferLocalApiInDevtools(error);
        const requestUrl = `${apiBaseUrl}${url}`;
        const { shortMessage, category, retryable } = describeWxRequestFail(error);
        reject({
          ...error,
          message: shortMessage,
          category,
          retryable,
          requestUrl,
          apiBaseUrl,
        });
      },
    });
  });
}

async function request({ url, method = "GET", data, header = {}, adminAuth = false }) {
  const app = getApp();
  const apiBaseUrl =
    (app && app.globalData && app.globalData.apiBaseUrl) || getApiBaseUrl();

  try {
    return await sendRequest({
      app,
      apiBaseUrl,
      url,
      method,
      data,
      header,
      adminAuth,
    });
  } catch (error) {
    if (
      error?.requiresRelogin &&
      app &&
      typeof app.wxLogin === "function" &&
      typeof app.logout === "function"
    ) {
      try {
        app.logout();
        await app.wxLogin({ forceRefresh: true });
        return await sendRequest({
          app,
          apiBaseUrl,
          url,
          method,
          data,
          header,
          adminAuth,
        });
      } catch (loginError) {
        throw {
          ...error,
          message: "需要重新登录",
          reloginFailed: true,
          loginError,
        };
      }
    }

    throw error;
  }
}

function requestLegacy(args) {
  return new Promise((resolve, reject) => {
    request(args).then(resolve).catch(reject);
  });
}

module.exports = {
  request: requestLegacy,
};
