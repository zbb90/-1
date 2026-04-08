const { isDevToolsEnvironment, LOCAL_API_ORIGIN } = require("../config");

/** 开发者工具内：线上 HTTPS 不可达时，仅提示一次可切回本机 */
let devtoolsLocalSwitchPrompted = false;

/**
 * 将 wx.request fail 回调中的 err 转为用户可见短文案 + 开发者工具下的详细说明。
 */
function describeWxRequestFail(error) {
  const errMsg = (error && error.errMsg) || "";

  if (
    errMsg.includes("ERR_CONNECTION_CLOSED") ||
    errMsg.includes("ERR_CONNECTION_RESET")
  ) {
    return {
      shortMessage: "连接被中断，请检查网络、代理或联系管理员排查服务器 HTTPS/Nginx",
      devtoolsDetail:
        "ERR_CONNECTION_CLOSED / ERR_CONNECTION_RESET：多为服务端 443/证书/Nginx、防火墙重置连接，或本机 VPN/代理。请在服务器确认 HTTPS 与反代；联调可在设置页切到 http://127.0.0.1:3003 并本地起后台。",
    };
  }

  if (/ssl|certificate|证书/i.test(errMsg)) {
    return {
      shortMessage: "HTTPS 证书异常，请联系管理员",
      devtoolsDetail: errMsg,
    };
  }

  if (errMsg.includes("timeout") || errMsg.includes("超时")) {
    return {
      shortMessage: "请求超时，请稍后重试",
      devtoolsDetail: errMsg,
    };
  }

  return {
    shortMessage: "网络请求失败，请检查接口地址或网络连接",
    devtoolsDetail: errMsg || JSON.stringify(error),
  };
}

function logNetworkFailIfDevtools(scope, error) {
  if (!isDevToolsEnvironment()) return;
  const { devtoolsDetail } = describeWxRequestFail(error);
  console.warn(`[${scope}]`, devtoolsDetail);
}

/** 传输层断连（关闭或 RST），与业务 HTTP 状态码无关 */
function isTransportDisconnectError(error) {
  const errMsg = (error && error.errMsg) || "";
  return (
    errMsg.includes("ERR_CONNECTION_CLOSED") || errMsg.includes("ERR_CONNECTION_RESET")
  );
}

function isConnectionClosedError(error) {
  return isTransportDisconnectError(error);
}

/**
 * 在模拟器里首次遇到连接被关闭且仍用默认线上地址时，引导切到本机联调。
 */
function maybeOfferLocalApiInDevtools(error) {
  if (devtoolsLocalSwitchPrompted) return;
  if (!isDevToolsEnvironment()) return;
  if (!isTransportDisconnectError(error)) return;
  const customOrigin = (wx.getStorageSync("apiOrigin") || "").trim();
  if (customOrigin) return;

  devtoolsLocalSwitchPrompted = true;
  wx.showModal({
    title: "无法连接线上接口",
    content:
      "多为服务器未正确配置 HTTPS（443）或本机网络问题。是否在开发者工具中改用本机 http://127.0.0.1:3003 联调？（需先在电脑执行 npm run dev:admin）",
    confirmText: "切到本地",
    cancelText: "取消",
    success(res) {
      if (!res.confirm) return;
      const app = getApp();
      if (app && typeof app.setApiOrigin === "function") {
        app.setApiOrigin(LOCAL_API_ORIGIN);
        wx.showToast({ title: "已切换，请重试操作", icon: "none" });
      }
    },
  });
}

module.exports = {
  describeWxRequestFail,
  logNetworkFailIfDevtools,
  isTransportDisconnectError,
  isConnectionClosedError,
  maybeOfferLocalApiInDevtools,
};
