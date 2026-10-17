/**
 * api.js — GitHub REST API v3 封装
 * 基于 Vela 官方 @system.fetch，Promise 化 + 统一错误处理 + 限流感知。
 * 网络链路：手表经小米运动健康蓝牙代理或 eSIM 独立联网，对应用层透明。
 */
import fetch from '@system.fetch';
import storage from '@system.storage';
import file from '@system.file';
import downloader from '@system.request';
import b64decode from './b64'; /* v1.2.3：通道⑤ contents JSON base64 解码（默认导出） */
import { bridgeFetch, bridgeSupported, bridgeReady, bridgeStats, bridgeKick as bridgeKick0, bridgeDiagnose as bridgeDiagnose0 } from './bridge'; /* v1.9.0：AstroBox 网桥（砍网机型经手机代发 HTTP） */

/** 批量标记通知线程已读（v1.2.3 CI 聚合卡长按用）：mapLimit 限并发 3，
 *  返回成功数；单条失败不计入（404 已读等常态）。 */
function _finallyRethrows(body, finalizer) {
  try {
    var result = body();
  } catch (e) {
    return finalizer(true, e);
  }
  if (result && result.then) {
    return result.then(finalizer.bind(null, false), finalizer.bind(null, true));
  }
  return finalizer(false, result);
}
function _catch(body, recover) {
  try {
    var result = body();
  } catch (e) {
    return recover(e);
  }
  if (result && result.then) {
    return result.then(void 0, recover);
  }
  return result;
}
function _settle(pact, state, value) {
  if (!pact.s) {
    if (value instanceof _Pact) {
      if (value.s) {
        if (state & 1) {
          state = value.s;
        }
        value = value.v;
      } else {
        value.o = _settle.bind(null, pact, state);
        return;
      }
    }
    if (value && value.then) {
      value.then(_settle.bind(null, pact, state), _settle.bind(null, pact, 2));
      return;
    }
    pact.s = state;
    pact.v = value;
    const observer = pact.o;
    if (observer) {
      observer(pact);
    }
  }
}
const _Pact = /*#__PURE__*/function () {
  function _Pact() {}
  _Pact.prototype.then = function (onFulfilled, onRejected) {
    const result = new _Pact();
    const state = this.s;
    if (state) {
      const callback = state & 1 ? onFulfilled : onRejected;
      if (callback) {
        try {
          _settle(result, 1, callback(this.v));
        } catch (e) {
          _settle(result, 2, e);
        }
        return result;
      } else {
        return this;
      }
    }
    this.o = function (_this) {
      try {
        const value = _this.v;
        if (_this.s & 1) {
          _settle(result, 1, onFulfilled ? onFulfilled(value) : value);
        } else if (onRejected) {
          _settle(result, 1, onRejected(value));
        } else {
          _settle(result, 2, value);
        }
      } catch (e) {
        _settle(result, 2, e);
      }
    };
    return result;
  };
  return _Pact;
}();
function _isSettledPact(thenable) {
  return thenable instanceof _Pact && thenable.s & 1;
}
function _for(test, update, body) {
  var stage;
  for (;;) {
    var shouldContinue = test();
    if (_isSettledPact(shouldContinue)) {
      shouldContinue = shouldContinue.v;
    }
    if (!shouldContinue) {
      return result;
    }
    if (shouldContinue.then) {
      stage = 0;
      break;
    }
    var result = body();
    if (result && result.then) {
      if (_isSettledPact(result)) {
        result = result.s;
      } else {
        stage = 1;
        break;
      }
    }
    if (update) {
      var updateValue = update();
      if (updateValue && updateValue.then && !_isSettledPact(updateValue)) {
        stage = 2;
        break;
      }
    }
  }
  var pact = new _Pact();
  var reject = _settle.bind(null, pact, 2);
  (stage === 0 ? shouldContinue.then(_resumeAfterTest) : stage === 1 ? result.then(_resumeAfterBody) : updateValue.then(_resumeAfterUpdate)).then(void 0, reject);
  return pact;
  function _resumeAfterBody(value) {
    result = value;
    do {
      if (update) {
        updateValue = update();
        if (updateValue && updateValue.then && !_isSettledPact(updateValue)) {
          updateValue.then(_resumeAfterUpdate).then(void 0, reject);
          return;
        }
      }
      shouldContinue = test();
      if (!shouldContinue || _isSettledPact(shouldContinue) && !shouldContinue.v) {
        _settle(pact, 1, result);
        return;
      }
      if (shouldContinue.then) {
        shouldContinue.then(_resumeAfterTest).then(void 0, reject);
        return;
      }
      result = body();
      if (_isSettledPact(result)) {
        result = result.v;
      }
    } while (!result || !result.then);
    result.then(_resumeAfterBody).then(void 0, reject);
  }
  function _resumeAfterTest(shouldContinue) {
    if (shouldContinue) {
      result = body();
      if (result && result.then) {
        result.then(_resumeAfterBody).then(void 0, reject);
      } else {
        _resumeAfterBody(result);
      }
    } else {
      _settle(pact, 1, result);
    }
  }
  function _resumeAfterUpdate() {
    if (shouldContinue = test()) {
      if (shouldContinue.then) {
        shouldContinue.then(_resumeAfterTest).then(void 0, reject);
      } else {
        _resumeAfterTest(shouldContinue);
      }
    } else {
      _settle(pact, 1, result);
    }
  }
}
function _forTo(array, body, check) {
  var i = -1,
    pact,
    reject;
  function _cycle(result) {
    try {
      while (++i < array.length && (!check || !check())) {
        result = body(i);
        if (result && result.then) {
          if (_isSettledPact(result)) {
            result = result.v;
          } else {
            result.then(_cycle, reject || (reject = _settle.bind(null, pact = new _Pact(), 2)));
            return;
          }
        }
      }
      if (pact) {
        _settle(pact, 1, result);
      } else {
        pact = result;
      }
    } catch (e) {
      _settle(pact || (pact = new _Pact()), 2, e);
    }
  }
  _cycle();
  return pact;
}
export const markThreadsRead = function (threadUrls) {
  try {
    const arr = Array.isArray(threadUrls) ? threadUrls : [];
    let ok = 0;
    return Promise.resolve(mapLimit(arr, 3, u => request(u, {
      method: 'PUT',
      body: {}
    }).then(() => {
      ok++;
    }).catch(() => {}))).then(function () {
      clearCache('/notifications');
      return ok;
    });
  } catch (e) {
    return Promise.reject(e);
  }
};
/** Copilot /models 动态目录（免费模型轮换不依赖硬编码）。
 *  响应 {data:[...]} 或 [...]；id 形如 gpt-5-mini / claude-haiku-4.5。
 *  截断风险低（瘦字段列表）仍挂 salvage 兜底；失败返回空数组。 */
export const copilotModels = function () {
  return Promise.resolve(copilotSession()).then(function (sess) {
    let _interrupt2 = false;
    function _temp71() {
      if (!res) return [];
      const code = Number(res.code) || 0;
      if (code < 200 || code >= 300) return [];
      const d = jsonMaybe(res);
      let arr = Array.isArray(d) ? d : d && Array.isArray(d.data) ? d.data : null;
      if (!arr && typeof res.data === 'string') {
        const sv = salvageJsonArray(String(res.data).replace(/^\uFEFF/, '').trim());
        if (sv) arr = sv.arr;
      }
      if (!arr) return [];
      /* v1.7.0 目录过滤 + 端点图 + 置顶（实弹实证 2026-10-10）：
       * - 全量 39.5KB 必被手表 8KB 截断 → salvage 片段只是目录头部；
       * - state=enabled 不可信（kimi/gpt-5.6-luna enabled 但免费层 400），
       *   state=disabled 与实测全一致 → 只剔除 disabled；
       * - 剔除 embeddings 与内部工具模型（copilot-search/exec-agent/trajectory/
       *   goldeneye/*-utility）；
       * - 顶层 supported_endpoints 记入 _cpModelEp（ws:/ 前缀为 WebSocket 变体，
       *   HTTP 客户端不适用，仅匹配 http 端点）；
       * - 实证可用模型置顶——目录原序 gpt-4o-mini 排 26+ 位，截断片段根本见不到。 */
      const epMap = {};
      const ids = [];
      for (let i = 0; i < arr.length; i++) {
        const m = arr[i] || {};
        const id = m.id || m.model || m.name;
        const cap = m.capabilities || {};
        const isChat = !cap.type || cap.type === 'chat';
        if (typeof id !== 'string' || !id.length || !isChat || ids.indexOf(id) >= 0) continue;
        if (m.policy && m.policy.state === 'disabled') continue;
        if (/^(copilot-search|exec-agent|trajectory-compaction|goldeneye)/.test(id) || /-utility$/.test(id)) continue;
        const eps = m.supported_endpoints;
        if (Array.isArray(eps)) {
          let hasChat = false,
            hasResp = false;
          for (let j = 0; j < eps.length; j++) {
            const e = String(eps[j] || '');
            if (e.indexOf('/chat/completions') >= 0) hasChat = true;else if (e.indexOf('/responses') >= 0) hasResp = true;
          }
          if (hasChat || hasResp) epMap[id] = {
            chat: hasChat,
            responses: hasResp
          };
        }
        ids.push(id);
      }
      for (const vk in epMap) _cpModelEp[vk] = epMap[vk];
      const vHead = [];
      const vTail = [];
      for (let i = 0; i < ids.length; i++) {
        if (CP_VERIFIED.indexOf(ids[i]) >= 0) vHead.push(ids[i]);else vTail.push(ids[i]);
      }
      const ordered = vHead.concat(vTail);
      if (ordered.length) _aiRemoteTs = Date.now();
      return ordered;
    }
    const header = {
      'User-Agent': CP_UA,
      Accept: 'application/json',
      Authorization: 'Bearer ' + sess.token,
      'X-GitHub-Api-Version': CP_API_VERSION
    };
    const idh = cpIdentityHeaders();
    for (const hk in idh) header[hk] = idh[hk];
    let res = null;
    let attempt = 0;
    const _temp70 = _for(function () {
      return !_interrupt2 && attempt < 2;
    }, function () {
      return attempt++;
    }, function () {
      const _temp69 = _catch(function () {
        return Promise.resolve(rawFetch({
          url: sess.api + '/models',
          method: 'GET',
          header: header
        })).then(function (_rawFetch) {
          res = _rawFetch;
          _interrupt2 = true;
        });
      }, function () {
        res = null;
      });
      if (_temp69 && _temp69.then) return _temp69.then(function () {});
    });
    return _temp70 && _temp70.then ? _temp70.then(_temp71) : _temp71(_temp70);
  });
};
/** 通道自检（AI 页「通道自检」）：
 *  ① Copilot 状态：GET /copilot_internal/user——v1.5.0 沙箱实证 PAT 也可查
 *    （套餐/聊天额度/端点全量返回）。旧版用 /user/copilot，对 PAT 恒 404，
 *    把已开通 Copilot Free 的账号误报成「未开通」并给出错误指引。
 *  ② 凭据交换实测：有 ghu_ 时真刀真枪换一次会话凭据。
 *  ③ Models：2026-07-30 已退役，静态说明（不再发无谓请求）。 */
export const aiProbe = function () {
  try {
    return Promise.resolve(loadToken()).then(function () {
      function _temp68() {
        return Promise.resolve(loadAiTok()).then(function () {
          function _temp66() {
            out.models = '2026-07-30 已退役';
            out.modelsHint = 'models.github.ai 已停服；免费层实测可用 gpt-4o-mini / gpt-4.1 / gpt-4o（2026-10-10 全矩阵实证）';
            return out;
          }
          const _temp65 = function () {
            if (_aiTok && String(_aiTok).indexOf('ghu_') === 0) {
              const _temp64 = _catch(function () {
                return Promise.resolve(copilotSession(true)).then(function (sess) {
                  out.exchange = '成功 · 端点 ' + sess.api.replace('https://', '');
                });
              }, function (e) {
                out.exchange = '失败：' + (e && e.message || '');
              });
              if (_temp64 && _temp64.then) return _temp64.then(function () {});
            } else {
              out.exchange = '未授权';
              const authHint = '当前 PAT 不能直连 Copilot（GitHub 限制）：点「Copilot 授权」一键设备授权，免打字，不影响已登录状态';
              out.copilotHint = out.copilotHint ? out.copilotHint + '\n' + authHint : authHint;
            }
          }();
          return _temp65 && _temp65.then ? _temp65.then(_temp66) : _temp66(_temp65);
        });
      }
      const out = {
        kind: aiTokenKind(),
        copilot: '',
        copilotHint: '',
        models: '',
        modelsHint: '',
        plan: '',
        quotaChat: '',
        exchange: ''
      };
      if (!_token) {
        out.copilot = out.models = '未登录';
        return out;
      }
      const _temp67 = _catch(function () {
        return Promise.resolve(request(COPILOT_USER_URL, {
          noCache: true,
          noDl: true
        })).then(function (u) {
          const sku = u && u.access_type_sku;
          const q = u && u.quota_snapshots && u.quota_snapshots.chat;
          out.plan = sku || '';
          if (sku) {
            out.copilot = '已开通（' + (sku === 'free_limited_copilot' ? 'Copilot Free' : sku) + (u.chat_enabled ? ' · 聊天可用' : '') + '）';
            if (q && typeof q.entitlement === 'number' && q.entitlement > 0) {
              out.quotaChat = (q.remaining || 0) + '/' + q.entitlement;
              out.copilot += ' · 会话额度 ' + out.quotaChat;
            }
          } else {
            out.copilot = '已登录（账号未关联 Copilot）';
            out.copilotHint = '电脑浏览器打开 github.com/settings/copilot 免费开通';
          }
        });
      }, function (e) {
        const st = Number(e && e.status) || 0;
        out.copilot = st === 404 ? '未开通' : '查询失败（' + st + '）';
        if (st === 404) out.copilotHint = '电脑浏览器打开 github.com/settings/copilot 免费开通 Copilot';
      });
      return _temp67 && _temp67.then ? _temp67.then(_temp68) : _temp68(_temp67);
    });
  } catch (e) {
    return Promise.reject(e);
  }
};
/** Copilot 对话。messages=[{role,content}]，opts: { model }。
 *  模型级失败（400/403/404：模型下线/无权限）自动降级下一模型，最多 3 个；
 *  429（额度）/needCopilot（未授权）等通道级失败直接透出（换模型无解）。 */
export const aiChat = function (messages, opts) {
  try {
    const t0 = Date.now();
    return Promise.resolve(loadToken()).then(function () {
      let _exit16 = false;
      function _temp63(_result28) {
        if (_exit16) return _result28;
        throw lastErr;
      }
      if (!_token) throw {
        status: 0,
        needAuth: true,
        message: 'AI 功能需登录 Token'
      };
      const o = opts || {};
      const list = aiModels();
      const model = o.model && list.indexOf(o.model) >= 0 ? o.model : list[0];
      const start = Math.max(0, list.indexOf(model));
      let lastErr = null;
      let t = 0;
      const _temp62 = _for(function () {
        return !_exit16 && t < Math.min(3, list.length);
      }, function () {
        return t++;
      }, function () {
        const useModel = list[(start + t) % list.length];
        return _catch(function () {
          return Promise.resolve(copilotSession()).then(function (sess) {
            let _exit17 = false;
            function _temp61(_result26) {
              if (_exit17) return _result26;
              let text = '';
              if (d && d.choices && d.choices[0] && d.choices[0].message && typeof d.choices[0].message.content === 'string') {
                text = d.choices[0].message.content;
              } else if (d) {
                text = respText(d);
              }
              /* v1.8.0 思考过程抽取（AI 页可折叠展示）：
               * - /responses：output[] 中 type=reasoning 的 summary[]/content[].text；
               * - /chat/completions：message.reasoning_content（DeepSeek 系）/
               *   message.reasoning（OpenRouter 系）。非推理模型两路皆空 → 不展示。 */
              let think = '';
              if (usedEp === 'responses') {
                if (d && Array.isArray(d.output)) {
                  for (let i = 0; i < d.output.length; i++) {
                    const ob = d.output[i] || {};
                    if (ob.type !== 'reasoning') continue;
                    const secs = [ob.summary, ob.content];
                    for (let s = 0; s < 2; s++) {
                      if (!Array.isArray(secs[s])) continue;
                      for (let j = 0; j < secs[s].length; j++) {
                        const x = secs[s][j];
                        if (x && typeof x.text === 'string' && x.text.length) think += (think ? '\n' : '') + x.text;
                      }
                    }
                  }
                }
              } else if (d && d.choices && d.choices[0] && d.choices[0].message) {
                const cm = d.choices[0].message;
                if (typeof cm.reasoning_content === 'string' && cm.reasoning_content.length) think = cm.reasoning_content;else if (typeof cm.reasoning === 'string' && cm.reasoning.length) think = cm.reasoning;
              }
              if (!text.length) {
                /* /responses 回退后仍无可取文本：回抛 chat 原始错误（信息量更大且保降级）；
                 * respOnly 直达则抛通用缺内容 */
                throw firstErr || {
                  message: 'AI 响应缺内容，请重试',
                  modelErr: true
                };
              }
              const _text$via$usage$model = {
                text: text,
                via: 'copilot',
                usage: d.usage || null,
                model: useModel,
                ep: usedEp,
                thinking: think.length > 1500 ? think.slice(0, 1500) + '\n…（思考过程已截断）' : think,
                ms: Date.now() - t0
              };
              _exit16 = true;
              return _text$via$usage$model;
            }
            const header = {
              'User-Agent': CP_UA,
              Authorization: 'Bearer ' + sess.token,
              'Content-Type': 'application/json',
              Accept: 'application/json',
              'X-GitHub-Api-Version': CP_API_VERSION
            };
            const idh = cpIdentityHeaders();
            for (const hk in idh) header[hk] = idh[hk];
            let usedEp = 'chat';
            let d = null;
            let firstErr = null;
            /* v1.7.0 端点路由三级：目录 supported_endpoints 精确图（copilotModels 填充）
             * > v1.6.0 前缀启发式 > 400/404 换端点重试。实弹实证 gpt-4o-mini 打
             * /responses 400 unsupported_api_endpoint（端点互斥）——图已知 chat-only
             * 时不再做无谓的 /responses 重试，省一轮往返。 */
            const epInfo = _cpModelEp[useModel] || null;
            const respOnly = epInfo ? !epInfo.chat && epInfo.responses : /^(gpt-5|codex|o1|o3|o4)/.test(useModel);
            const canRetryOther = epInfo ? respOnly ? epInfo.chat : epInfo.responses : true;
            const _temp60 = function () {
              if (respOnly) {
                usedEp = 'responses';
                return Promise.resolve(aiPost(sess.api + '/responses', header, {
                  model: useModel,
                  input: messages,
                  max_output_tokens: AI_MAX_TOKENS
                }, '端点')).then(function (_aiPost) {
                  d = _aiPost;
                });
              } else {
                return _catch(function () {
                  return Promise.resolve(aiPost(sess.api + '/chat/completions', header, {
                    messages: messages,
                    model: useModel,
                    max_tokens: AI_MAX_TOKENS
                  }, 'chat')).then(function (_aiPost2) {
                    d = _aiPost2;
                  });
                }, function (e1) {
                  const st1 = Number(e1 && e1.status) || 0;
                  if (st1 !== 400 && st1 !== 404 || !canRetryOther) throw e1;
                  firstErr = e1;
                  usedEp = 'responses';
                  return Promise.resolve(aiPost(sess.api + '/responses', header, {
                    model: useModel,
                    input: messages,
                    max_output_tokens: AI_MAX_TOKENS
                  }, '端点')).then(function (_aiPost3) {
                    d = _aiPost3;
                  });
                });
              }
            }();
            return _temp60 && _temp60.then ? _temp60.then(_temp61) : _temp61(_temp60);
          });
        }, function (e) {
          /* v1.6.0：降级耗尽后保留信息量最大的错误（带原文的 400/403 优先于
           * 「缺内容」类通用噪声），用户看到的是真因 */
          if (!lastErr || String(e && e.message || '').length > String(lastErr && lastErr.message || '').length) lastErr = e;
          /* 交换失败/未授权/未登录是通道级失败，立即透出（换模型无解） */
          if (e.needCopilot || e.exchangeFail || e.needAuth) throw e;
          const st = Number(e && e.status) || 0;
          const msg = String(e && e.message || '');
          const modelErr = e.modelErr || st === 400 || st === 403 || st === 404 || /model|access|permission|权限/i.test(msg);
          if (!modelErr) throw e;
        });
      });
      return _temp62 && _temp62.then ? _temp62.then(_temp63) : _temp63(_temp62);
    });
  } catch (e) {
    return Promise.reject(e);
  }
};
/** AI POST（不走缓存管线）：非 2xx 一律透出响应原文片段（可自诊断）。
 *  结构化 error.message 优先，否则取原文前 120 字。 */
const aiPost = function (url, header, bodyObj, tag) {
  try {
    let _interrupt9 = false;
    function _temp122() {
      const tg = tag ? '[' + tag + '] ' : '';
      if (!res) throw {
        status: 0,
        message: tg + 'AI 网络失败，请检查手表网络'
      };
      const code = Number(res.code) || 0;
      if (code >= 200 && code < 300) {
        const d = jsonMaybe(res);
        if (!d) throw {
          status: code,
          message: tg + 'AI 通道 2xx 但响应非 JSON'
        };
        return d;
      }
      const dErr = jsonMaybe(res);
      const em = dErr && dErr.error && dErr.error.message;
      const raw = typeof res.data === 'string' ? String(res.data).trim().slice(0, 120) : '';
      throw {
        status: code,
        message: tg + (em || raw || 'AI 服务 HTTP ' + code)
      };
    }
    let res = null;
    let attempt = 0;
    const _temp121 = _for(function () {
      return !_interrupt9 && attempt < 2;
    }, function () {
      return attempt++;
    }, function () {
      const _temp120 = _catch(function () {
        return Promise.resolve(rawFetch({
          url: url,
          method: 'POST',
          header: header,
          data: JSON.stringify(bodyObj)
        })).then(function (_rawFetch6) {
          res = _rawFetch6;
          _interrupt9 = true;
        });
      }, function () {
        res = null;
      });
      if (_temp120 && _temp120.then) return _temp120.then(function () {});
    });
    return Promise.resolve(_temp121 && _temp121.then ? _temp121.then(_temp122) : _temp122(_temp121));
  } catch (e) {
    return Promise.reject(e);
  }
};
/** /responses 响应文本抽取（output_text 直取 → output[] content[].text 拼接）。
 *  v1.8.0：type=reasoning 节点不算正文（其 summary/content 归 thinking 展示），
 *  避免部分实现把推理文本同时塞进 content 时正文重复。 */
/** 会话凭据交换：GET copilot_internal/v2/token（Authorization: token <ghu_>）。
 *  2026 实证：只收 GitHub App 用户 token（ghu_）；响应 endpoints.api 为按
 *  套餐定制的 API 域名（individual 账号实测 api.individual.githubcopilot.com），
 *  后续 chat/models 一律走该端点（api.githubcopilot.com 作兜底）。 */
const copilotSession = function (force) {
  try {
    if (_cpSess && !force && _cpSess.exp - Date.now() > 120000) return Promise.resolve(_cpSess);
    return Promise.resolve(loadAiTok()).then(function () {
      let _interrupt8 = false;
      function _temp119() {
        if (!res) throw {
          status: 0,
          message: '[交换] Copilot 凭据网络失败，请检查手表网络'
        };
        const code = Number(res.code) || 0;
        const d = jsonMaybe(res);
        if (!d || !d.token) {
          const raw = typeof res.data === 'string' ? String(res.data).trim().slice(0, 120) : '';
          if (code === 401 || code === 404) {
            throw {
              status: code,
              needCopilot: true,
              message: '[交换] Copilot 凭据被拒（' + code + '）：请点紫卡重新 Copilot 授权'
            };
          }
          if (code === 403) {
            throw {
              status: code,
              exchangeFail: true,
              message: '[交换] Copilot 凭据被拒（403）' + (raw ? '：' + raw : '') + ' → 点「Copilot 授权」重新授权一次'
            };
          }
          throw {
            status: code,
            exchangeFail: true,
            message: '[交换] Copilot 凭据失败（HTTP ' + code + '）' + (raw ? '：' + raw : '')
          };
        }
        const api = d.endpoints && d.endpoints.api || COPILOT_API_FALLBACK;
        _cpSess = {
          token: String(d.token),
          api: String(api).replace(/\/+$/, ''),
          exp: (Number(d.expires_at) || 0) * 1000
        };
        return _cpSess;
      }
      if (!_aiTok) {
        throw {
          status: 0,
          needCopilot: true,
          message: '需要 Copilot 设备授权：点「Copilot 授权」一键完成（免打字）'
        };
      }
      /* v1.6.0：交换段用 LiteLLM 实证头（GithubCopilot/1.155.0 + vscode/1.85.1），
       * 不再复用调用段 vscode-chat 头；403/5xx 属通道级失败，标 exchangeFail
       * 让 aiChat 立即透出——换模型对交换失败无解，旧版白耗 2 轮模型循环。 */
      const header = {
        Accept: 'application/json',
        Authorization: 'token ' + _aiTok
      };
      const eh = cpExchHeaders();
      for (const hk in eh) header[hk] = eh[hk];
      let res = null;
      let attempt = 0;
      const _temp118 = _for(function () {
        return !_interrupt8 && attempt < 2;
      }, function () {
        return attempt++;
      }, function () {
        const _temp117 = _catch(function () {
          return Promise.resolve(rawFetch({
            url: COPILOT_TOK_URL,
            method: 'GET',
            header: header
          })).then(function (_rawFetch5) {
            res = _rawFetch5;
            _interrupt8 = true;
          });
        }, function () {
          res = null;
        });
        if (_temp117 && _temp117.then) return _temp117.then(function () {});
      });
      return _temp118 && _temp118.then ? _temp118.then(_temp119) : _temp119(_temp118);
    });
  } catch (e) {
    return Promise.reject(e);
  }
};
/** 保存/清除 AI token（双通道与主 token 同款），并作废会话凭据缓存 */
export const saveAiTok = function (token) {
  try {
    function _temp59() {
      _cpSess = null;
      _aiTokReady = Promise.resolve(_aiTok);
      return _aiTok;
    }
    _aiTok = (token || '').trim();
    const _temp58 = function () {
      if (_aiTok) {
        function _temp54() {
          const _temp52 = _catch(function () {
            return Promise.resolve(fileSet(AI_TOK_FILE, _aiTok)).then(function () {});
          }, function () {});
          if (_temp52 && _temp52.then) return _temp52.then(function () {});
        }
        const _temp53 = _catch(function () {
          return Promise.resolve(stSet(AI_TOK_KEY, _aiTok)).then(function () {});
        }, function () {});
        return _temp53 && _temp53.then ? _temp53.then(_temp54) : _temp54(_temp53);
      } else {
        function _temp57() {
          const _temp55 = _catch(function () {
            return Promise.resolve(fileRemove(AI_TOK_FILE)).then(function () {});
          }, function () {});
          if (_temp55 && _temp55.then) return _temp55.then(function () {});
        }
        const _temp56 = _catch(function () {
          return Promise.resolve(stRemove(AI_TOK_KEY)).then(function () {});
        }, function () {});
        return _temp56 && _temp56.then ? _temp56.then(_temp57) : _temp57(_temp56);
      }
    }();
    return Promise.resolve(_temp58 && _temp58.then ? _temp58.then(_temp59) : _temp59(_temp58));
  } catch (e) {
    return Promise.reject(e);
  }
};
/** commit 历史 + CI 状态（需登录）：
 *  返回 {commits, total, hasNext}；游客抛 {needAuth:true}，GraphQL 网络失败/限流
 *  重试后仍失败 → 抛错（REST /actions/runs 单条 17.7KB 恒超截断阈值，无回退通道）。
 *  v1.2.4：branch 为空走 defaultBranchRef（旧版 refs/heads/HEAD 实测 ref:null，
 *  是 CI 页「显示我无ci」的直接根因）。 */
export const getCommitChecks = function (fullName, branch, page) {
  try {
    return Promise.resolve(loadToken()).then(function () {
      function _temp48() {
        const target = useBranch ? dig(d, ['repository', 'ref', 'target']) : dig(d, ['repository', 'defaultBranchRef', 'target']);
        if (!target) {
          throw {
            status: 404,
            message: useBranch ? '分支不存在（' + useBranch + '）' : '仓库为空或无默认分支'
          };
        }
        const h = target.history;
        if (!h || !Array.isArray(h.nodes)) throw {
          status: 0,
          message: '提交历史为空'
        };
        if ((page || 1) >= 1) cursorSave(key, page || 1, h.pageInfo);
        const commits = [];
        for (let i = 0; i < h.nodes.length; i++) {
          const c = gqlCommitToRest(h.nodes[i]);
          if (c) commits.push(c);
        }
        return {
          commits: commits,
          total: h.totalCount || commits.length,
          hasNext: !!(h.pageInfo && h.pageInfo.hasNextPage)
        };
      }
      if (!_token) throw {
        status: 0,
        needAuth: true,
        message: '查看 CI 状态需登录 Token（设置 → 填入/登录）'
      };
      const parts = fullName.split('/');
      if (parts.length !== 2) throw {
        status: 404,
        message: '仓库地址无效'
      };
      const useBranch = branch || '';
      const key = 'cc|' + fullName + '|' + (useBranch || 'DEFAULT');
      const after = cursorFor(key, page || 1);
      if ((page || 1) > 1 && after === undefined) throw {
        status: 0,
        message: '分页游标断链，请从第一页重试'
      };
      const vars = {
        o: parts[0],
        n: parts[1],
        first: 10,
        after: after === null ? undefined : after
      };
      let d = null;
      const _temp47 = function () {
        if (useBranch) {
          return Promise.resolve(ghql(GQL_COMMITS_REF_Q, Object.assign(vars, {
            branch: 'refs/heads/' + useBranch
          }))).then(function (_ghql) {
            d = _ghql;
          });
        } else {
          return Promise.resolve(ghql(GQL_COMMITS_DEF_Q, vars)).then(function (_ghql2) {
            d = _ghql2;
          });
        }
      }();
      return _temp47 && _temp47.then ? _temp47.then(_temp48) : _temp48(_temp47);
    });
  } catch (e) {
    return Promise.reject(e);
  }
};

/* ================= v1.5.0 Copilot 专区（AI 单通道重构） =================
 *  2026-07-30 GitHub Models（models.github.ai）全面退役（官方 docs 实证：
 *  playground/catalog/inference API 全部下线）——v1.3.0-v1.4.0 的 Models 兜底
 *  通道打在死服务上，即「AI 依旧使用不了」的终极根因。
 *  Copilot Chat API 是唯一存活的内置模型通道（VS Code 免费模型同款链路）：
 *    设备授权（GitHub App Iv1.b507a08c87ecfe98 → ghu_）
 *    → GET api.github.com/copilot_internal/v2/token 换 ~30min 会话凭据
 *    → POST {endpoints.api}/chat/completions（2026-08-01 版本头 + CLI 身份头）
 *  实测矩阵（2026-10 沙箱）：
 *    · PAT 直连 Copilot API → 400 "Personal Access Tokens are not supported"
 *    · gho_（OAuth App 设备授权）→ 会话交换端点拒绝（只收 GitHub App ghu_）
 *    · /copilot_internal/user 探测 PAT 可查（plan/quota/端点全量返回）
 *  → PAT 主账号需做一次「Copilot 设备授权」（免打字，独立存储不影响主 token）；
 *  旧版设备授权 gho_ 直连 Bearer 仍可用 GA 模型（opencode 实证），保留兼容。
 *  模型列表动态拉取 GET /models（免费模型轮换不再依赖硬编码）；所有非 2xx
 *  错误透出响应原文片段（不再笼统报「网关异常」，用户可自诊断）。 */
/** Issue 关闭/重开（state: 'closed' | 'open'）；完成后作废该 issue 缓存 */
export const patchIssueState = function (full, n, state) {
  try {
    return Promise.resolve(request('/repos/' + full + '/issues/' + n, {
      method: 'PATCH',
      body: {
        state: state
      }
    })).then(function (r) {
      clearCache('/repos/' + full + '/issues/' + n);
      return r;
    });
  } catch (e) {
    return Promise.reject(e);
  }
};

/* ================= v1.2.3 Actions（commit CI 历史）新功能 =================
 * 用户未读通知 200+ 条中 99% 为 ci_activity（CheckSuite CI 通知，实测）——
 * 通知聚合卡点开的落点就是「看看哪次构建挂了」。
 * 实测选型：REST /actions/runs 单条全字段 ~17.7KB（head_commit 全家桶），任意
 * per_page 均超 14.3KB 蓝牙截断阈值——彻底不可用；GraphQL 无 workflowRuns 字段
 * （schema 实证 undefinedField），但 Commit.history + statusCheckRollup 可用，
 * 瘦字段每条 ~370B，10 条 ~3KB 一页安全到达。游客/GraphQL 全灭 → 抛需登录提示。 */

/* v1.2.4 根修「显示我无ci」：无分支参数时旧版拼 refs/heads/HEAD —— 沙箱实测
 * GitHub 返回 ref:null（HEAD 不是合法 qualifiedName），CI 历史页从通知聚合卡/
 * 仓库页进入（均不传分支）必然报「分支不存在」。现拆两条查询：
 *  - 无分支：defaultBranchRef{target} 直达默认分支头提交，零额外请求；
 *  - 有分支：ref(qualifiedName:'refs/heads/<branch>') 原路径保留。 */
/** 订阅态切换（三态循环 off → on → ignore → off）；完成后作废订阅缓存 */
export const setRepoSubscription = function (full, state) {
  try {
    function _temp46() {
      clearCache('/repos/' + full + '/subscription');
      return r;
    }
    let r;
    const _temp45 = function () {
      if (state === 'off') {
        return Promise.resolve(request('/repos/' + full + '/subscription', {
          method: 'DELETE'
        })).then(function (_request3) {
          r = _request3;
        });
      } else {
        return Promise.resolve(request('/repos/' + full + '/subscription', {
          method: 'PUT',
          body: {
            subscribed: state === 'on',
            ignored: state === 'ignore'
          }
        })).then(function (_request4) {
          r = _request4;
        });
      }
    }();
    return Promise.resolve(_temp45 && _temp45.then ? _temp45.then(_temp46) : _temp46(_temp45));
  } catch (e) {
    return Promise.reject(e);
  }
};
/** 订阅态查询：off（未订阅/404）| on（subscribed）| ignore（忽略通知）。
 *  与通知降噪联动：在手表上直接把噪音仓库设为 ignore，源头不再进通知列表。 */
export const getRepoSubscription = function (full) {
  try {
    if (!_token) return Promise.resolve({
      state: 'off'
    });
    return Promise.resolve(_catch(function () {
      return Promise.resolve(request('/repos/' + full + '/subscription')).then(function (s) {
        return {
          state: s && s.ignored ? 'ignore' : 'on'
        };
      });
    }, function (e) {
      if (e && e.status === 404) return {
        state: 'off'
      };
      throw e;
    }));
  } catch (e) {
    return Promise.reject(e);
  }
};
/** Release 列表（GraphQL 无 assets 数组/上传 URL 全家桶，体积降 3-5 倍；REST 兜底） */
export const getReleases = function (fullName, page) {
  try {
    return Promise.resolve(_catch(function () {
      const parts = String(fullName || '').split('/');
      const key = 'rel|' + fullName;
      const cursor = cursorFor(key, page || 1);
      if (cursor === undefined) throw {
        cursorMiss: true
      };
      return Promise.resolve(ghql(GQL_RELEASES_Q, {
        o: parts[0],
        n: parts[1],
        first: PER_PAGE,
        after: cursor
      })).then(function (data) {
        const conn = dig(data, ['repository', 'releases']);
        if (!conn) throw {
          status: 404,
          message: '内容不存在（404）'
        };
        cursorSave(key, page || 1, conn.pageInfo);
        _lastListPerPage = PER_PAGE;
        return (conn.nodes || []).map(gqlReleaseToRest).filter(x => !!x && !!x.tag_name);
      });
    }, function (e) {
      if (gqlShouldFallback(e)) {
        return requestAdaptive('rel-rest|' + fullName, per => '/repos/' + fullName + '/releases' + qs({
          page: page || 1,
          per_page: per
        }), page || 1);
      }
      throw e;
    }));
  } catch (e) {
    return Promise.reject(e);
  }
};

/** 是否已 Star */
export const getIssue = function (fullName, number) {
  try {
    let _exit13 = false;
    function _temp44(_result22) {
      let _exit14 = false;
      if (_exit13) return _result22;
      function _temp42(_result23) {
        let _exit15 = false;
        if (_exit14) return _result23;
        function _temp40(_result24) {
          if (_exit15) return _result24;
          throw {
            status: 0,
            incomplete: true,
            message: '详情响应不完整（fetch/下载器/GraphQL 三通道均失败），请稍后重试'
          };
        }
        const _temp39 = _catch(function () {
          const parts = String(fullName || '').split('/');
          return Promise.resolve(ghql(GQL_ISSUE_Q, {
            o: parts[0],
            n: parts[1],
            num: Number(number)
          })).then(function (d) {
            const io = d && d.repository && d.repository.issueOrPullRequest;
            if (io && io.number) {
              const _number$title$state$c = {
                number: io.number,
                title: io.title,
                state: String(io.state || 'open').toLowerCase(),
                created_at: io.createdAt,
                user: io.author ? {
                  login: io.author.login
                } : null,
                comments: io.comments && io.comments.totalCount || 0,
                labels: (io.labels && io.labels.nodes ? io.labels.nodes : []).map(function (l) {
                  return {
                    name: l.name,
                    color: String(l.color || '').replace('#', '')
                  };
                }),
                body: '',
                __bodyTruncated: true,
                __via: 'gql'
              };
              _exit15 = true;
              return _number$title$state$c;
            }
          });
        }, function () {});
        /* ③ GraphQL 逃生（无 body，仅头部字段 + 计数） */
        return _temp39 && _temp39.then ? _temp39.then(_temp40) : _temp40(_temp39);
      }
      const _temp41 = _catch(function () {
        const header = {
          'User-Agent': 'vela-github-client',
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        };
        if (_token) header['Authorization'] = 'Bearer ' + _token;
        return Promise.resolve(dlFetchText(API_BASE + path, header, {
          download: 15000,
          complete: 40000,
          read: 10000
        })).then(function (text) {
          const cleaned = String(text).replace(/^\uFEFF/, '').trim();
          if (cleaned && cleaned.charAt(0) === '{') {
            const d = JSON.parse(cleaned);
            if (d && d.number) {
              d.__via = 'dl';
              _exit14 = true;
              return d;
            }
          }
        });
      }, function () {});
      /* ② REST 原生下载器（JSON 形态） */
      return _temp41 && _temp41.then ? _temp41.then(_temp42) : _temp42(_temp41);
    }
    const path = '/repos/' + fullName + '/issues/' + number;
    const _temp43 = _catch(function () {
      return Promise.resolve(request(path)).then(function (r) {
        if (r && typeof r === 'object' && r.number) {
          _exit13 = true;
          return r;
        }
        throw {
          incomplete: true
        };
      });
    }, function (e) {
      if (!(e && (e.incomplete || e.timeout))) throw e;
    });
    return Promise.resolve(_temp43 && _temp43.then ? _temp43.then(_temp44) : _temp44(_temp43));
  } catch (e) {
    return Promise.reject(e);
  }
};

/** Issue 评论列表（传 comments_url；评论正文可能很长，同样自适应） */
/** Issue 列表（GraphQL 无 body 瘦字段，天然免截断；issues 连接不含 PR，
 *  无需过滤；REST 兜底保留 PR 过滤逻辑） */
export const getIssues = function (fullName, page, state) {
  try {
    return Promise.resolve(_catch(function () {
      const parts = String(fullName || '').split('/');
      const key = 'issues|' + fullName + '|' + (state || 'open');
      const cursor = cursorFor(key, page);
      if (cursor === undefined) throw {
        cursorMiss: true
      };
      const v = {
        o: parts[0],
        n: parts[1],
        first: PER_PAGE,
        after: cursor
      };
      if (!state || state === 'open') v.states = ['OPEN'];else if (state === 'closed') v.states = ['CLOSED'];
      /* state=all → 不传 states（OPEN+CLOSED 全量） */
      return Promise.resolve(ghql(GQL_ISSUES_Q, v)).then(function (data) {
        const conn = dig(data, ['repository', 'issues']);
        if (!conn) throw {
          status: 404,
          message: '内容不存在（404）'
        };
        cursorSave(key, page, conn.pageInfo);
        _lastListPerPage = PER_PAGE;
        return (conn.nodes || []).map(gqlIssueToRest).filter(x => !!x && x.title != null);
      });
    }, function (e) {
      if (gqlShouldFallback(e)) return restIssues(fullName, page, state);
      throw e;
    }));
  } catch (e) {
    return Promise.reject(e);
  }
};

/** Issue 详情 */
/** v1.3.0 三级通道根治「点开通知 → 响应数据不完整」：
 *  根因：详情 JSON 内嵌 body 全文，长正文的 Issue/PR 30-100KB 必被蓝牙代理
 *  截断（fetch 通道同 URL 重试无解）。链路：
 *  ① REST fetch（短正文 <14.3KB 截断下限内最稳）；
 *  ② 截断 → REST 原生下载器（与 fetch 不同路，文件管线 v1.2.2 实证可靠）；
 *  ③ 下载器失败/不可用 → GraphQL issueOrPullRequest 瘦字段逃生
 *     （响应 ~1KB 必达，body 置空 + __bodyTruncated=true，页面显示省略提示）。
 *  附 __via 供诊断。 */
/** 文件原始文本（保持 v1.2.0 契约：直接返回字符串；readme 页等沿用） */
export const getFileRaw = function (fullName, path, ref) {
  return Promise.resolve(getFileRawEx(fullName, path, ref, null)).then(function (r) {
    if (typeof r.text === 'string' && r.text.length) return r.text;
    throw {
      message: '文件内容为空'
    };
  });
};
/** 文件内容拉取（v1.2.2 弦电子书式重写）：
 *  ① 磁盘缓存（fcache，冷启仍有效，重进秒开零传输）；
 *  ② 原生下载器整文件落盘为主通道（绕开 fetch 蓝牙代理截断——真机实证 Range
 *     分块第 2 块起必失败、REST raw 大文件空体/截断，均为死路）；
 *  ③ fetch Range 分块（带逐块进度，下载器不可用时的回退）；
 *  ④ REST contents raw 兜底（私有仓库 raw 404 场景）。
 *  返回 {text, full, capped, bytes, via}；capped=true 表示超 1MB 只取前 1MB。 */
export const getFileRawEx = function (fullName, path, ref, onProgress, expectedSize) {
  try {
    const url = rawFileUrl(fullName, ref || '', path);
    const prog = (a, b) => {
      if (typeof onProgress === 'function') {
        try {
          onProgress(a, b);
        } catch (e) {}
      }
    };
    /* v1.4.0：完整性校验基准——目录项自带字节数（GraphQL/REST 列表均有）。
     * 各通道取回正文与基准不符 → 判截断/污染 → 不缓存、直接落下一通道。
     * 「加载 8KB 后内容为空」类静默截断的终极守门员（有基准才启用）。 */
    const want = Number(expectedSize) > 0 ? Number(expectedSize) : 0;
    const sizeBad = t => !!want && utf8Len(t) !== want;

    /* ① 磁盘缓存命中（v1.4.0：与基准不符的历史截断体作废重拉） */
    return Promise.resolve(fcacheGet(url)).then(function (cached) {
      let _exit7 = false;
      function _temp38(_result1) {
        let _exit8 = false;
        if (_exit7) return _result1;
        function _temp36(_result12) {
          let _exit9 = false;
          if (_exit8) return _result12;
          function _temp34(_result13) {
            let _exit0 = false;
            if (_exit9) return _result13;
            function _temp32(_result15) {
              let _exit10 = false;
              if (_exit0) return _result15;
              function _temp30(_result17) {
                let _exit11 = false;
                if (_exit10) return _result17;
                function _temp28(_result19) {
                  let _exit12 = false;
                  if (_exit11) return _result19;
                  function _temp26(_result21) {
                    if (_exit12) return _result21;
                    /* 五通道全失败的最终诊断：给出每通道失败形态，绝不再返回空内容。
                     *  v1.2.3：任一通道出现确定性截断（incomplete）则标志透传——
                     *  上游自适应分页/错误路径依赖该标志识别「截断」类失败。 */
                    throw {
                      status: 0,
                      incomplete: inc4,
                      message: '文件加载失败（下载器/分块/raw/base64 通道均不可用，raw ' + via4 + '），请稍后重试'
                    };
                  }
                  const _temp25 = function () {
                    if (d5 && d5.type === 'file' && typeof d5.content === 'string' && d5.content.length) {
                      let text5 = '';
                      try {
                        text5 = b64decode.decode(d5.content);
                      } catch (e) {
                        throw {
                          status: 0,
                          message: '文件内容解码失败（base64），请重试'
                        };
                      }
                      return function () {
                        if (text5) {
                          let capped5 = false;
                          if (utf8Len(text5) > FILE_RAW_CAP) {
                            text5 = utf8SliceBytes(text5, FILE_RAW_CAP);
                            capped5 = true;
                          }
                          return Promise.resolve(fcachePut(url, text5)).then(function () {
                            const _text$full$capped$byt6 = {
                              text: text5,
                              full: true,
                              capped: capped5,
                              bytes: utf8Len(text5),
                              via: 'b64'
                            };
                            _exit12 = true;
                            return _text$full$capped$byt6;
                          });
                        }
                      }();
                    }
                  }();
                  return _temp25 && _temp25.then ? _temp25.then(_temp26) : _temp26(_temp25);
                }
                /* ⑥ v1.2.3 contents JSON base64 终备通道：
                 *  与 raw 完全不同的响应形态（api.github.com JSON，代理处理最成熟的形态）。
                 *  JSON 体 ≈ 元数据 700B + base64×1.37 → 文件 ≤9.5KB 时整响应 <14.3KB 截断下限，
                 *  可靠到达；>9.5KB 的 JSON 必截断（确定性失败）→ 抛错走页面重试提示。
                 *  四通道全失败时给出明确诊断（覆盖真机「加载 8KB 后内容为空」的完整故障链）。 */
                let d5 = null;
                const _temp27 = _catch(function () {
                  return Promise.resolve(request('/repos/' + fullName + '/contents' + p + qs({
                    ref: ref || undefined
                  }))).then(function (_request2) {
                    d5 = _request2;
                  });
                }, function (e5) {
                  /* v1.2.3：incomplete 标志必须透传（自适应分页/页面错误路径依赖它识别截断）；
                   * 同时附可行动文案 */
                  if (e5 && e5.incomplete) {
                    throw {
                      status: 0,
                      incomplete: true,
                      message: '文件较大且网络通道受限，请稍后重试（蓝牙代理对大响应有限制）'
                    };
                  }
                  throw e5;
                });
                return _temp27 && _temp27.then ? _temp27.then(_temp28) : _temp28(_temp27);
              }
              const _temp29 = _catch(function () {
                return Promise.resolve(ghqlBlob(fullName, path, ref)).then(function (g5) {
                  return function () {
                    if (g5 && typeof g5.text === 'string' && g5.text.length) {
                      if (g5.isBinary) throw {
                        binary: true,
                        message: '二进制文件，暂不支持预览'
                      };
                      if (sizeBad(g5.text)) throw {
                        status: 200,
                        incomplete: true
                      };
                      return Promise.resolve(fcachePut(url, g5.text)).then(function () {
                        const nb5 = utf8Len(g5.text);
                        prog(nb5, nb5);
                        const _text$full$capped$byt5 = {
                          text: g5.text,
                          full: true,
                          capped: false,
                          bytes: nb5,
                          via: 'gql'
                        };
                        _exit10 = true;
                        return _text$full$capped$byt5;
                      });
                    }
                  }();
                });
              }, function (e5) {
                if (e5 && e5.binary) throw e5;
                /* 落 base64 终备 */
              });
              /* ⑤ v1.4.0 GraphQL Blob 直读（≤11KB 小文件的最稳通道）：
               *  object(expression:"ref:path"){...on Blob{text}} 返回 UTF-8 原文——无 base64
               *  膨胀、无元数据噪声（响应 ≈ 文件字节 + 300B），配 identity 头在 14.3KB 实证
               *  阈值内。失败（游客/限流/结构/网关）静默落 ⑥ base64 终备。 */
              return _temp29 && _temp29.then ? _temp29.then(_temp30) : _temp30(_temp29);
            }
            /* ④ REST contents raw 兜底（私有仓库 raw 404 的场景）。
             *  v1.2.3：空体绝不再静默返回（旧版返回 {text:''} → 页面「文件内容为空」）
             *  ——空体/JSON 体均视为本通道失败，续走 ⑤ base64 通道。 */
            const p = path ? '/' + path : '';
            let via4 = '';
            let inc4 = false;
            const _temp31 = _catch(function () {
              return Promise.resolve(request('/repos/' + fullName + '/contents' + p + qs({
                ref: ref || undefined
              }), {
                raw: true
              })).then(function (text4) {
                let _exit1 = false;
                function _temp24(_result16) {
                  if (_exit1) return _result16;
                  via4 = sizeBad(t4) ? 'truncated' : t4 ? 'error-body' : 'empty';
                }
                const t4 = String(text4 == null ? '' : text4);
                const _temp23 = function () {
                  if (t4 && !sniffRawErrorBody(t4) && !sizeBad(t4)) {
                    return Promise.resolve(fcachePut(url, t4)).then(function () {
                      const _text$full$capped$byt4 = {
                        text: t4,
                        full: true,
                        capped: false,
                        bytes: utf8Len(t4),
                        via: 'rest'
                      };
                      _exit0 = true;
                      return _text$full$capped$byt4;
                    });
                  }
                }();
                return _temp23 && _temp23.then ? _temp23.then(_temp24) : _temp24(_temp23);
              });
            }, function (e) {
              if (e && e.binary) throw e;
              via4 = e && e.message || 'fail';
              inc4 = !!(e && e.incomplete);
            });
            return _temp31 && _temp31.then ? _temp31.then(_temp32) : _temp32(_temp31);
          }
          const _temp33 = _catch(function () {
            return Promise.resolve(fetchRawChunked(url, onProgress)).then(function (r) {
              return function () {
                if (typeof r.text === 'string' && r.text.length) {
                  if (!r.capped && sizeBad(r.text)) throw {
                    status: 200,
                    incomplete: true,
                    message: '分块响应不完整'
                  };
                  return Promise.resolve(fcachePut(url, r.text)).then(function () {
                    const _text$full$capped$byt3 = {
                      text: r.text,
                      full: !!r.full,
                      capped: !!r.capped,
                      bytes: utf8Len(r.text),
                      via: 'chunk'
                    };
                    _exit9 = true;
                    return _text$full$capped$byt3;
                  });
                }
              }();
            });
          }, function (e) {
            if (e && e.binary) throw e;
            /* 落到 REST raw */
          });
          /* ③ fetch Range 分块（逐块进度；v1.4.0 补完整性校验） */
          return _temp33 && _temp33.then ? _temp33.then(_temp34) : _temp34(_temp33);
        }
        const rawHeader = {
          'User-Agent': 'vela-github-client',
          Accept: 'application/octet-stream'
        };
        for (const hk in H_IDENTITY) rawHeader[hk] = H_IDENTITY[hk];
        if (_token) rawHeader['Authorization'] = 'Bearer ' + _token;
        /* v1.4.0：api.github.com raw 主域——代理可达性已被全部 JSON 请求实证；
         * raw.githubusercontent.com 副域（历史主通道）。双域 = 主域 404/不可达时不死。 */
        /* ② 原生下载器主通道：一次整文件落盘（≤1MB 由页面 rawSize 守卫）。
         *  v1.2.3：超时 45/75/15 —— 真机蓝牙代理实测下载仅数 KB/s。
         *  v1.4.0：双域逐试 + URL 扰动（绕代理同 URL 去重）+ 字节完整性校验。 */
        /* URL 保持原生形态（下载器管线无同 URL 去重问题，扰动属 fetch 分块专用） */
        const apiRawHeader = {
          'User-Agent': 'vela-github-client',
          Accept: 'application/vnd.github.raw'
        };
        for (const hk in H_IDENTITY) apiRawHeader[hk] = apiRawHeader[hk];
        if (_token) apiRawHeader['Authorization'] = 'Bearer ' + _token;
        const encPath = String(path || '').split('/').map(encodeURIComponent).join('/');
        const apiRawUrl = API_BASE + '/repos/' + fullName + '/contents/' + encPath + qs({
          ref: ref || undefined
        });
        const dlT = {
          download: 45000,
          complete: 75000,
          read: 15000
        };
        const dlPlans = [{
          u: apiRawUrl,
          h: apiRawHeader,
          api: true,
          via: 'dl-api'
        }, {
          u: url,
          h: rawHeader,
          api: false,
          via: 'dl'
        }];
        const _temp35 = _forTo(dlPlans, function (di) {
          return _catch(function () {
            return Promise.resolve(dlFetchText(dlPlans[di].u, dlPlans[di].h, dlT)).then(function (dl) {
              return function () {
                if (typeof dl === 'string' && dl.length) {
                  if (sniffRawErrorBody(dl) || dlPlans[di].api && dl.charAt(0) === '{' && /"message"\s*:/.test(dl.slice(0, 160))) {
                    throw {
                      status: 404,
                      message: '下载器返回错误体，转下一通道'
                    };
                  }
                  if (dl.slice(0, 512).indexOf('\u0000') >= 0) throw {
                    binary: true,
                    message: '二进制文件，暂不支持预览'
                  };
                  let text = dl;
                  let capped = false;
                  if (utf8Len(text) > FILE_RAW_CAP) {
                    text = utf8SliceBytes(text, FILE_RAW_CAP);
                    capped = true;
                  }
                  if (!capped && sizeBad(text)) throw {
                    status: 200,
                    incomplete: true,
                    message: '下载器响应不完整，转下一通道'
                  };
                  return Promise.resolve(fcachePut(url, text)).then(function () {
                    const nb = utf8Len(text);
                    prog(nb, nb);
                    const _text$full$capped$byt2 = {
                      text: text,
                      full: true,
                      capped: capped,
                      bytes: nb,
                      via: dlPlans[di].via
                    };
                    _exit8 = true;
                    return _text$full$capped$byt2;
                  });
                }
              }();
            });
          }, function (e) {
            if (e && e.binary) throw e;
            /* 该域失败 → 下一域/分块通道 */
          });
        }, function () {
          return _exit8;
        });
        return _temp35 && _temp35.then ? _temp35.then(_temp36) : _temp36(_temp35);
      }
      const _temp37 = function () {
        if (cached) {
          return function () {
            if (sizeBad(cached)) {
              return Promise.resolve(fcacheDrop(url)).then(function () {});
            } else {
              const cb = utf8Len(cached);
              prog(cb, cb);
              const _text$full$capped$byt = {
                text: cached,
                full: true,
                capped: false,
                bytes: cb,
                via: 'cache'
              };
              _exit7 = true;
              return _text$full$capped$byt;
            }
          }();
        }
      }();
      return _temp37 && _temp37.then ? _temp37.then(_temp38) : _temp38(_temp37);
    });
  } catch (e) {
    return Promise.reject(e);
  }
};
/** Blob 正文直读（GraphQL）：响应 ≈ 文件字节 + 300B，无 base64 膨胀，
 *  ≤11KB 小文件配 identity 头在截断阈值内。失败抛错由调用方落下一通道。 */
export const ghqlBlob = function (fullName, path, ref) {
  try {
    const parts = String(fullName || '').split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) throw {
      status: 0,
      message: '仓库参数不完整'
    };
    const expr = (ref || 'HEAD') + ':' + (path || '');
    return Promise.resolve(ghql(GQL_BLOB_Q, {
      o: parts[0],
      n: parts[1],
      e: expr
    })).then(function (data) {
      const obj = dig(data, ['repository', 'object']);
      if (!obj || obj.__typename !== 'Blob') throw {
        status: 404,
        message: '内容不存在（404）'
      };
      return {
        text: typeof obj.text === 'string' ? obj.text : '',
        isBinary: !!obj.isBinary,
        byteSize: obj.byteSize || 0
      };
    });
  } catch (e) {
    return Promise.reject(e);
  }
};
/** 目录列表（GraphQL 瘦字段）。path 以 '' 为根；ref 空取 HEAD。
 *  返回与 REST contents 同构的数组：{name,path,type:'dir'|'file',size,sha}。
 *  路径不存在 → 404（GitHub 路径区分大小写，页面直接显示明确文案）。 */
export const getDirList = function (fullName, path, ref) {
  try {
    const parts = String(fullName || '').split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) throw {
      status: 0,
      gqlSkip: true,
      message: '仓库参数不完整'
    };
    const expr = (ref || 'HEAD') + ':' + (path || '');
    return Promise.resolve(ghql(GQL_DIR_Q, {
      o: parts[0],
      n: parts[1],
      e: expr
    })).then(function (data) {
      const obj = dig(data, ['repository', 'object']);
      if (!obj) throw {
        status: 404,
        message: '内容不存在（404，GitHub 路径区分大小写）'
      };
      if (obj.__typename === 'Blob') throw {
        status: 0,
        gqlSkip: true,
        message: '该路径是文件'
      };
      const entries = obj.entries || [];
      const base = path ? path + '/' : '';
      const out = [];
      for (let i = 0; i < entries.length; i++) {
        const x = entries[i];
        out.push({
          name: x.name,
          path: base + x.name,
          type: x.type === 'tree' ? 'dir' : 'file',
          size: x.object && x.object.byteSize || 0,
          sha: x.oid || ''
        });
      }
      return out;
    });
  } catch (e) {
    return Promise.reject(e);
  }
};
/** v1.3.0：git 树 + 原生下载器兜底——「访问深目录数据不完整/死机」根治。
 *  深层/巨型目录（如 node_modules 单层数百条目）contents 与 trees 的 fetch
 *  响应 30-120KB 必截断；下载器与 fetch 不同路（文件管线实证可靠），
 *  整树 JSON 一次到齐 → 配合页面目录分页（节点数上限）双保险。 */
export const getTreeEx = function (fullName, sha) {
  try {
    let _exit6 = false;
    function _temp22(_result9) {
      if (_exit6) return _result9;
      const header = {
        'User-Agent': 'vela-github-client',
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      };
      for (const hk in H_IDENTITY) header[hk] = H_IDENTITY[hk];
      if (_token) header['Authorization'] = 'Bearer ' + _token;
      return Promise.resolve(dlFetchText(API_BASE + path, header, {
        download: 15000,
        complete: 60000,
        read: 12000
      })).then(function (text) {
        const cleaned = String(text).replace(/^\uFEFF/, '').trim();
        if (!cleaned || cleaned.charAt(0) !== '{') throw {
          status: 200,
          incomplete: true,
          message: '目录树响应异常'
        };
        const d = JSON.parse(cleaned);
        if (!d || !Array.isArray(d.tree)) throw {
          status: 200,
          incomplete: true,
          message: '目录树响应不完整'
        };
        return d;
      });
    }
    const path = '/repos/' + fullName + '/git/trees/' + (sha || 'HEAD');
    const _temp21 = _catch(function () {
      return Promise.resolve(request(path)).then(function (_await$request) {
        _exit6 = true;
        return _await$request;
      });
    }, function (e) {
      if (!(e && (e.incomplete || e.timeout))) throw e;
    });
    return Promise.resolve(_temp21 && _temp21.then ? _temp21.then(_temp22) : _temp22(_temp21));
  } catch (e) {
    return Promise.reject(e);
  }
};

/* ================= v1.4.0：GraphQL 目录列表 / Blob 正文快车道 =================
 * 蓝牙代理截断只看响应体大小：REST 目录列表单条目 300-500B（contents）/250B
 * （trees），GraphQL 只取渲染所需瘦字段 → 单条目 ~70B，同目录响应缩 4-7 倍，
 * 中型目录（≤100 条）在 8KB 分块阈值内直达；巨型目录仍走 getTreeEx 下载器。
 * 失败（游客/限流/网络/结构）一律由页面回落 REST 阶梯，功能不倒退。 */
export const getRepo = function (fullName) {
  try {
    let _exit5 = false;
    function _temp20(_result8) {
      return _exit5 ? _result8 : request('/repos/' + fullName);
    }
    const parts = String(fullName || '').split('/');
    const _temp19 = function () {
      if (parts.length === 2 && parts[0] && parts[1]) {
        return _catch(function () {
          return Promise.resolve(ghql(GQL_REPO_Q, {
            o: parts[0],
            n: parts[1]
          })).then(function (data) {
            const r = data && data.repository;
            if (!r || !r.nameWithOwner) throw {
              status: 0,
              gqlSkip: true,
              message: 'GraphQL 仓库详情为空'
            };
            const _id$full_name$name$ow = {
              id: r.id || fullName,
              full_name: r.nameWithOwner,
              name: String(r.nameWithOwner).split('/')[1] || parts[1],
              owner: {
                login: r.owner && r.owner.login || parts[0]
              },
              description: r.description || '',
              stargazers_count: r.stargazerCount || 0,
              forks_count: r.forkCount || 0,
              subscribers_count: r.watchers && r.watchers.totalCount || 0,
              open_issues_count: r.issues && r.issues.totalCount || 0,
              language: r.primaryLanguage && r.primaryLanguage.name,
              license: r.licenseInfo && r.licenseInfo.spdxId ? {
                spdx_id: r.licenseInfo.spdxId,
                name: r.licenseInfo.spdxId
              } : null,
              pushed_at: r.pushedAt || r.updatedAt || '',
              created_at: r.createdAt || '',
              updated_at: r.updatedAt || '',
              homepage: r.homepageUrl || '',
              default_branch: r.defaultBranchRef && r.defaultBranchRef.name || 'HEAD',
              fork: !!r.isFork,
              private: !!r.isPrivate
            };
            _exit5 = true;
            return _id$full_name$name$ow;
          });
        }, function (e) {
          if (!gqlShouldFallback(e)) throw e;
          /* 游客/限流/网络失败 → 回落 REST */
        });
      }
    }();
    return Promise.resolve(_temp19 && _temp19.then ? _temp19.then(_temp20) : _temp20(_temp19));
  } catch (e) {
    return Promise.reject(e);
  }
};

/** README（base64） */
/** 趋势模拟（GraphQL 瘦字段，REST 兜底；返回 {items,total_count} 契约不变） */
export const getTrending = function (mode, page) {
  try {
    return Promise.resolve(_catch(function () {
      const key = 'trending|' + (mode || 'classic');
      const cursor = cursorFor(key, page);
      if (cursor === undefined) throw {
        cursorMiss: true
      };
      return Promise.resolve(ghql(GQL_SEARCH_Q, {
        q: trendingQuery(mode) + ' sort:stars',
        first: PER_PAGE,
        after: cursor
      })).then(function (data) {
        const s = dig(data, ['search']);
        if (!s) throw {
          status: 0,
          gqlSkip: true,
          message: 'GraphQL 响应缺 search'
        };
        cursorSave(key, page, s.pageInfo);
        _lastListPerPage = PER_PAGE;
        return {
          items: (s.nodes || []).map(gqlRepoToRest).filter(x => !!x && !!x.full_name),
          total_count: s.repositoryCount || 0
        };
      });
    }, function (e) {
      if (gqlShouldFallback(e)) return restTrending(mode, page);
      throw e;
    }));
  } catch (e) {
    return Promise.reject(e);
  }
};

/** 仓库详情（v1.2.1：GraphQL 瘦字段 ~1KB，替代 REST 全量 10-20KB——
 *  单页详情从源头避开蓝牙代理截断；失败回退 REST） */
/** 仓库搜索（GraphQL 瘦字段，REST 兜底；返回 {items,total_count} 契约不变） */
export const searchRepos = function (keyword, page, sort) {
  try {
    return Promise.resolve(_catch(function () {
      const key = 'search|' + keyword + '|' + (sort || '');
      const cursor = cursorFor(key, page);
      if (cursor === undefined) throw {
        cursorMiss: true
      };
      return Promise.resolve(ghql(GQL_SEARCH_Q, {
        q: keyword + searchSortQ(sort),
        first: PER_PAGE,
        after: cursor
      })).then(function (data) {
        const s = dig(data, ['search']);
        if (!s) throw {
          status: 0,
          gqlSkip: true,
          message: 'GraphQL 响应缺 search'
        };
        cursorSave(key, page, s.pageInfo);
        _lastListPerPage = PER_PAGE;
        return {
          items: (s.nodes || []).map(gqlRepoToRest).filter(x => !!x && !!x.full_name),
          total_count: s.repositoryCount || 0
        };
      });
    }, function (e) {
      if (gqlShouldFallback(e)) return restSearch(keyword, page, sort);
      throw e;
    }));
  } catch (e) {
    return Promise.reject(e);
  }
};

/**
 * 趋势模拟（GitHub 无官方 Trending API）
 * mode: new=本周新星 / rising=季度黑马 / classic=经典名库
 */
/** 指定用户的公开仓库（GraphQL 瘦字段，REST 兜底） */
export const getUserRepos = function (login, page) {
  try {
    return Promise.resolve(_catch(function () {
      const key = 'userrepos|' + login;
      const cursor = cursorFor(key, page);
      if (cursor === undefined) throw {
        cursorMiss: true
      };
      return Promise.resolve(ghql(GQL_USERREPOS_Q, {
        login: login,
        first: PER_PAGE,
        after: cursor
      })).then(function (data) {
        const conn = dig(data, ['repositoryOwner', 'repositories']);
        if (!conn) throw {
          status: 404,
          message: '内容不存在（404）'
        };
        cursorSave(key, page, conn.pageInfo);
        _lastListPerPage = PER_PAGE;
        return (conn.nodes || []).map(gqlRepoToRest).filter(x => !!x && !!x.full_name);
      });
    }, function (e) {
      if (gqlShouldFallback(e)) return restUserRepos(login, page);
      throw e;
    }));
  } catch (e) {
    return Promise.reject(e);
  }
};
/** 登录用户仓库（GraphQL 瘦字段，REST 兜底） */
export const getMyRepos = function (page, sort) {
  try {
    return Promise.resolve(_catch(function () {
      const key = 'myrepos|' + (sort || 'pushed');
      const cursor = cursorFor(key, page);
      if (cursor === undefined) throw {
        cursorMiss: true
      };
      return Promise.resolve(ghql(GQL_MYREPOS_Q, {
        first: PER_PAGE,
        after: cursor,
        order: {
          field: repoOrderField(sort),
          direction: 'DESC'
        }
      })).then(function (data) {
        const conn = dig(data, ['viewer', 'repositories']);
        if (!conn) throw {
          status: 0,
          gqlSkip: true,
          message: 'GraphQL 响应缺 viewer.repositories'
        };
        cursorSave(key, page, conn.pageInfo);
        _lastListPerPage = PER_PAGE;
        return (conn.nodes || []).map(gqlRepoToRest).filter(x => !!x && !!x.full_name);
      });
    }, function (e) {
      if (gqlShouldFallback(e)) return restMyRepos(page, sort);
      throw e;
    }));
  } catch (e) {
    return Promise.reject(e);
  }
};
export const getNotifications = function (page, all, participating) {
  try {
    return Promise.resolve(loadToken()).then(function () {
      const pg = Math.max(1, page);
      const base = (pg - 1) * NOTIF_PAGE_N + 1;
      const subs = [];
      for (let i = 0; i < NOTIF_PAGE_N; i++) subs.push(base + i);
      const parts = new Array(NOTIF_PAGE_N);
      const failed = [];
      return Promise.resolve(mapLimit(subs, NOTIF_CONC, sp => notifSubPage(sp, all, participating).then(arr => ({
        ok: true,
        arr: arr
      })).catch(e => ({
        ok: false,
        err: e
      })))).then(function (first) {
        function _temp18() {
          const out = [];
          _lastNotifGaps = [];
          for (let i = 0; i < NOTIF_PAGE_N; i++) {
            if (parts[i] === undefined) {
              _lastNotifGaps.push(subs[i]);
              continue;
            }
            const arr = parts[i];
            for (let j = 0; j < arr.length; j++) out.push(arr[j]);
          }
          return out;
        }
        for (let i = 0; i < first.length; i++) {
          const r = first[i];
          if (r.ok) parts[i] = r.arr;else if (notifGapable(r.err)) failed.push(i);else throw r.err;
        }
        /* 失败段低并发（2）重试一轮：蓝牙代理瞬时故障大概率此轮恢复 */
        const _temp17 = function () {
          if (failed.length) {
            return Promise.resolve(mapLimit(failed, 2, i => notifSubPage(subs[i], all, participating).then(arr => ({
              ok: true,
              arr: arr
            })).catch(e => ({
              ok: false,
              err: e
            })))).then(function (second) {
              for (let i = 0; i < second.length; i++) {
                const r = second[i];
                if (r.ok) parts[failed[i]] = r.arr;
              }
            });
          }
        }();
        return _temp17 && _temp17.then ? _temp17.then(_temp18) : _temp18(_temp17);
      });
    });
  } catch (e) {
    return Promise.reject(e);
  }
};

/** 全部标记已读 */
/** v1.5.0：单页直拉（per=1）——不再有 per=2 整段→per=1 降级树。
 *  salvage 命中按 URL 记键（并发互不覆盖）；残片（长度<1）即空数组，
 *  直接交 getNotifications 的 gap 机制处理。 */
const notifSubPage = function (sp, all, participating) {
  try {
    return notifOnce(notifUrl1(sp, all, participating, 1));
  } catch (e) {
    return Promise.reject(e);
  }
};
/** 该段失败是否可「留缺口继续」：incomplete（含下载器兜底失败）/ 超时可降级为
 *  gap；404/401/403 等硬错误必须整页抛出（v1.2.2 契约：绝不静默缺条）。 */
const notifDl = function (url) {
  try {
    const header = {
      'User-Agent': 'vela-github-client',
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    for (const hk in H_IDENTITY) header[hk] = H_IDENTITY[hk];
    if (_token) header['Authorization'] = 'Bearer ' + _token;
    return Promise.resolve(dlFetchText(url, header, NOTIF_DL_T)).then(function (text) {
      const cleaned = String(text).replace(/^\uFEFF/, '').trim();
      if (!cleaned) throw {
        status: 200,
        incomplete: true,
        message: '通知下载器空响应'
      };
      try {
        return JSON.parse(cleaned);
      } catch (e) {
        // v1.4.0：下载器截断同样可抢救（通知管线按长度补拉尾部）
        const sv = salvageJsonArray(cleaned);
        if (sv) {
          salvageMark(url, sv.arr.length);
          return sv.arr;
        }
        throw {
          status: 200,
          incomplete: true,
          message: '下载器响应不是有效 JSON'
        };
      }
    });
  } catch (e) {
    return Promise.reject(e);
  }
};
/** 通知 URL（per=1 单条；all=全部、participating=仅参与）。
 *  v1.3.0：participating 过滤——未读通知 99% 是 ci_activity 噪音（用户 200+ 条），
 *  participating=true 只留「我参与的对话」，列表从百页级缩到 1-2 页。 */
/** 单条通知请求（fetch 主通道）：salvage 开启（截断残片抢救为罕见兜底）。
 *  v1.5.0：per=1 单条 ~5.6KB 稳在 8KB 阈值内，不再需要 per=2→per=1 分级；
 *  截断仍发生时请求层自动重试 1 次，仍失败走原生下载器（notifDl ~40s 判死）。 */
const notifOnce = function (pathUrl) {
  try {
    return Promise.resolve(_catch(function () {
      return Promise.resolve(request(pathUrl, {
        noDl: true,
        salvage: true
      }));
    }, function (e) {
      if (!e || !e.incomplete) throw e;
      return _catch(function () {
        return Promise.resolve(notifDl(API_BASE + pathUrl));
      }, function () {
        throw {
          status: 0,
          incomplete: true,
          message: '通知响应不完整（fetch+下载器双通道均失败）'
        };
      });
    }));
  } catch (e) {
    return Promise.reject(e);
  }
};
/** v1.2.4：通知下载器兜底 —— 真机实测 per=1 单条 ~6.3KB 响应仍偶发被代理截断
 *  （「响应数据不完整」残存案例），fetch 与原生下载器不同路（v1.2.2 大文件管线
 *  实证可靠）。超时收紧 6/12/4s：单条 JSON 极小，正常秒回，最坏 ~22s 判死。 */
/* v1.3.0：真机实测蓝牙代理下载器启动即需数秒（大文件管线 45s 同源），
 *  6s 启动超时把「能到的响应」误判为死 → gap 警告频发（用户体感依旧不完整）。
 *  放宽到 10/22/8：单条 JSON 极小，正常仍秒回，最坏 ~40s 判死。 */
/** 当前登录用户（带进程内缓存，v1.2.1：按 token 绑定防换号脏读）；未登录返回 null */
export const self = function () {
  try {
    let _exit4 = false;
    if (!_token) return Promise.resolve(null);
    if (_self && _self.__tk === _token) return Promise.resolve(_self);
    const _temp16 = _catch(function () {
      return Promise.resolve(request('/user')).then(function (_request) {
        _self = _request;
        if (_self) _self.__tk = _token;
      });
    }, function (e) {
      _self = null;
      throw e;
    });
    return Promise.resolve(_temp16 && _temp16.then ? _temp16.then(function (_result6) {
      return _exit4 ? _result6 : _self;
    }) : _exit4 ? _temp16 : _self);
  } catch (e) {
    return Promise.reject(e);
  }
};

/* ---------------- 端点封装 ---------------- */

/** 限流余量查询（不消耗 core 配额；实时数据不走缓存） */
/** 第二步：轮询一次授权状态。永不抛错（轮询失败是常态），状态机返回：
 *  ok{token} / pending / slow{interval} / expired / denied / netfail / error */
export const deviceFlowPoll = function (deviceCode, intervalSec, mode) {
  try {
    let _exit3 = false;
    function _temp15(_result5) {
      if (_exit3) return _result5;
      const d = jsonMaybe(res);
      if (d && d.access_token) return {
        state: 'ok',
        token: String(d.access_token)
      };
      const err = d && d.error;
      if (err === 'authorization_pending') return {
        state: 'pending'
      };
      return err === 'slow_down' ? {
        state: 'slow',
        interval: (intervalSec || 5) + 5
      } : err === 'expired_token' ? {
        state: 'expired'
      } : err === 'access_denied' ? {
        state: 'denied'
      } : {
        state: 'error',
        status: Number(res.code) || 0
      };
    }
    const clientId = mode === 'copilot' ? DEVICE_CLIENT_COPILOT : DEVICE_CLIENT_LOGIN;
    let res;
    const _temp14 = _catch(function () {
      return Promise.resolve(formPost(DEVICE_URL_TOKEN, {
        client_id: clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
      })).then(function (_formPost2) {
        res = _formPost2;
      });
    }, function () {
      const _state = {
        state: 'netfail'
      };
      _exit3 = true;
      return _state;
    });
    return Promise.resolve(_temp14 && _temp14.then ? _temp14.then(_temp15) : _temp15(_temp14));
  } catch (e) {
    return Promise.reject(e);
  }
};

/* ---------------- URL 工具 ---------------- */
/** 第一步：发起 Device Flow。mode='login'（主登录）| 'copilot'（AI 专用授权）。
 *  返回 {deviceCode,userCode,verifyUri,expiresIn,interval} */
export const deviceFlowStart = function (mode) {
  try {
    let _interrupt = false;
    function _temp13() {
      if (!res) throw {
        status: 0,
        message: '网络连接失败，请检查手表网络'
      };
      const code = Number(res.code) || 0;
      const d = jsonMaybe(res);
      if (code < 200 || code >= 300 || !d || !d.device_code || !d.user_code) {
        throw {
          status: code,
          message: '发起登录失败（HTTP ' + code + '），请重试'
        };
      }
      return {
        deviceCode: String(d.device_code),
        userCode: String(d.user_code),
        verifyUri: String(d.verification_uri || 'https://github.com/login/device'),
        expiresIn: Number(d.expires_in) || 900,
        interval: Number(d.interval) || 5
      };
    }
    const cp = mode === 'copilot';
    const clientId = cp ? DEVICE_CLIENT_COPILOT : DEVICE_CLIENT_LOGIN;
    const scope = cp ? DEVICE_SCOPE_COPILOT : DEVICE_SCOPE_LOGIN;
    let res = null;
    let attempt = 0;
    const _temp12 = _for(function () {
      return !_interrupt && attempt < 3;
    }, function () {
      return attempt++;
    }, function () {
      function _temp11() {
        const _temp1 = _catch(function () {
          return Promise.resolve(formPost(DEVICE_URL_CODE, {
            client_id: clientId,
            scope: scope
          })).then(function (_formPost) {
            res = _formPost;
            const dTry = jsonMaybe(res);
            if (res && Number(res.code) >= 200 && Number(res.code) < 300 && dTry && dTry.device_code) {
              _interrupt = true;
              return;
            }
            res = null;
          });
        }, function () {
          res = null;
        });
        if (_temp1 && _temp1.then) return _temp1.then(function () {});
      }
      const _temp10 = function () {
        if (attempt > 0) return Promise.resolve(new Promise(r => setTimeout(r, attempt === 1 ? 1200 : 2400))).then(function () {});
      }();
      return _temp10 && _temp10.then ? _temp10.then(_temp11) : _temp11(_temp10);
    });
    return Promise.resolve(_temp12 && _temp12.then ? _temp12.then(_temp13) : _temp13(_temp12));
  } catch (e) {
    return Promise.reject(e);
  }
};
/** README 全文（v1.2.2：下载器落盘优先 + 磁盘缓存 → Range 分块 → REST base64）。
 *  任何失败抛 {fallback:true}，readme 页回退 REST base64 通道（现行为）。 */
export const getReadmeText = function (fullName, ref) {
  try {
    return Promise.resolve(loadToken()).then(function () {
      function _temp0() {
        if (!name) throw {
          fallback: true,
          message: '未在仓库根目录找到 README'
        };
        const url = rawFileUrl(fullName, ref || 'HEAD', name);

        /* 磁盘缓存（冷启/重进秒开） */
        /* 原生下载器优先（整文件落盘，绕开蓝牙代理截断） */
        return Promise.resolve(fcacheGet(url)).then(function (cached) {
          let _exit = false;
          function _temp8(_result2) {
            let _exit2 = false;
            if (_exit) return _result2;
            function _temp6(_result4) {
              if (_exit2) return _result4;
              if (!r.text || !r.text.length) throw {
                fallback: true,
                message: 'README 内容为空'
              };
              return Promise.resolve(fcachePut(url, r.text)).then(function () {
                return {
                  text: r.text,
                  name: name,
                  raw: true
                };
              });
            }
            let r;
            const _temp5 = _catch(function () {
              return Promise.resolve(fetchRawChunked(url)).then(function (_fetchRawChunked) {
                r = _fetchRawChunked;
              });
            }, function (e) {
              throw {
                fallback: true,
                status: e && e.status,
                message: e && e.message || 'README 分块拉取失败'
              };
            });
            return _temp5 && _temp5.then ? _temp5.then(_temp6) : _temp6(_temp5);
          }
          if (cached) return {
            text: cached,
            name: name,
            raw: true
          };
          const rawHeader = {
            'User-Agent': 'vela-github-client',
            Accept: 'application/octet-stream'
          };
          if (_token) rawHeader['Authorization'] = 'Bearer ' + _token;
          const _temp7 = _catch(function () {
            return Promise.resolve(dlFetchText(url, rawHeader, {
              download: 45000,
              complete: 75000,
              read: 15000
            })).then(function (dl) {
              return function () {
                if (typeof dl === 'string' && dl.length && !sniffRawErrorBody(dl) && dl.slice(0, 512).indexOf('\u0000') < 0) {
                  return Promise.resolve(fcachePut(url, dl)).then(function () {
                    const _text$name$raw = {
                      text: dl,
                      name: name,
                      raw: true
                    };
                    _exit = true;
                    return _text$name$raw;
                  });
                }
              }();
            });
          }, function () {});
          return _temp7 && _temp7.then ? _temp7.then(_temp8) : _temp8(_temp7);
        });
      }
      let name = '';
      const _temp9 = _catch(function () {
        return Promise.resolve(getTree(fullName, 'HEAD')).then(function (t) {
          const arr = t && Array.isArray(t.tree) ? t.tree : [];
          for (let i = 0; i < arr.length; i++) {
            if (arr[i] && arr[i].type === 'blob' && README_RE.test(arr[i].path || '')) {
              name = arr[i].path;
              break;
            }
          }
        });
      }, function () {});
      return _temp9 && _temp9.then ? _temp9.then(_temp0) : _temp0(_temp9);
    });
  } catch (e) {
    return Promise.reject(e);
  }
};

/* ================= v1.2.0 Device Flow 免打字登录 =================
 * 手表显示 8 位用户码，用户在手机/电脑浏览器打开 github.com/login/device
 * 输入该码并授权，手表轮询拿到 OAuth Token——全程无需在手表上打字。
 * client_id 复用 GitHub CLI 的公开 OAuth App（第三方工具通行做法），
 * 仅作 device flow 发起方，Token 由 GitHub 直接发给本机，不经过任何第三方。 */

/* v1.5.0：拆双模式——
 *  login：主登录沿用原 OAuth App（repo/notifications 全权限）；
 *    scope 收敛回三个基础项（copilot/models 不是合法 OAuth scope，
 *    v1.3.0/v1.4.0 追加后 FULL 首试恒被拒，纯耗一轮请求）。
 *  copilot：GitHub Copilot CLI 的 GitHub App（Iv1.b507a08c87ecfe98，
 *    2026 第三方客户端通行 client），产出 ghu_——copilot_internal/v2/token
 *    实证只收 GitHub App 用户 token（ghu_），OAuth App 的 gho_ 与 PAT 均被拒。
 *    专用授权与主 token 分离存储，PAT 主账号不受任何影响。 */
/** Range 分块取回全文。返回 {text, full, capped}：
 *  full=true 表示服务器不支持 Range（首块即全文，走降级路径）；
 *  capped=true 表示达到 1MB 块数上限仍有后续数据（文件被截断显示）。
 *  v1.2.1：新增 onProgress(loadedBytes, totalBytes) 进度回调（total 取自
 *  首块 Content-Range），结果写入内存缓存（5min TTL，返回导航免重拉）。 */
const fetchRawChunked = function (url, onProgress) {
  try {
    let _exit28 = false,
      _interrupt7 = false;
    function _temp116(_result48) {
      if (_exit28) return _result48;
      if (!complete) {
        /* 块数耗尽仍有后续数据：明确告知截断，绝不冒充完整 */
        const res3 = {
          text: out,
          full: false,
          capped: true
        };
        memSet(url, res3, firstEtag);
        return res3;
      }
      const res4 = {
        text: out,
        full: full,
        capped: false
      };
      memSet(url, res4, firstEtag);
      return res4;
    }
    const hit = _mem.map[url];
    if (hit && hit.data && typeof hit.data.text === 'string' && Date.now() - hit.ts < RAW_TTL) {
      return Promise.resolve(hit.data);
    }
    let mode = 'arraybuffer';
    let out = '';
    let pending = [];
    let offset = 0;
    let total = 0;
    let firstEtag = '';
    let complete = false;
    let full = false;
    let bi = 0;
    const _temp115 = _for(function () {
      return !(_interrupt7 || _exit28) && bi < RAW_MAX_BLOCKS;
    }, function () {
      return bi++;
    }, function () {
      return Promise.resolve(rawRangeRetry(url, offset, offset + RAW_CHUNK - 1, mode)).then(function (r) {
        function _temp114() {
          if (r.code === 416) {
            complete = true;
            _interrupt7 = true;
            return;
          } /* 整块对齐时末尾越界 → 已取完 */
          /* 短块 = 末块 */
          if (r.code === 200) {
            /* Range 被忽略：首块即全文（可能超阈值），只能整体返回（降级）；
             * 但 200 全文同样可能被蓝牙代理截断——content-length 对照检测与
             * request() raw 模式同口径，绝不静默渲染残缺内容 */
            complete = true;
            if (offset > 0) {
              _interrupt7 = true;
              return;
            }
            if (typeof r.data === 'string') {
              const s = r.data;
              if (!s) throw {
                status: 200,
                incomplete: true,
                message: 'raw 全文响应不完整'
              };
              const clen = parseInt(pickHeader(r.headers, 'content-length'));
              if (!isNaN(clen) && clen > 0 && utf8Len(s) + 8 < clen) {
                throw {
                  status: 200,
                  incomplete: true,
                  message: 'raw 全文响应不完整（疑似截断）'
                };
              }
              full = true;
              const res1 = {
                text: s,
                full: true,
                capped: false
              };
              memSet(url, res1, pickHeader(r.headers, 'etag'));
              _exit28 = true;
              return res1;
            }
            const u8full = toU8(r.data);
            if (u8full) {
              if (sniffBinary(u8full)) throw {
                status: 200,
                binary: true,
                message: '二进制文件，暂不支持预览'
              };
              const dec = utf8DecodeChunk([], u8full);
              full = true;
              const res2 = {
                text: dec.text,
                full: true,
                capped: false
              };
              memSet(url, res2, pickHeader(r.headers, 'etag'));
              _exit28 = true;
              return res2;
            }
            throw {
              status: 200,
              incomplete: true,
              message: 'raw 全文响应异常'
            };
          }
          if (r.code !== 206) throw {
            status: r.code,
            message: 'raw 拉取失败（HTTP ' + r.code + '）'
          };
          if (!firstEtag) firstEtag = pickHeader(r.headers, 'etag');
          let got = 0;
          if (mode === 'arraybuffer') {
            const u8 = toU8(r.data);
            if (!u8) throw {
              status: 206,
              message: '分块响应异常'
            };
            if (bi === 0 && sniffBinary(u8)) throw {
              status: 206,
              binary: true,
              message: '二进制文件，暂不支持预览'
            };
            const dec = utf8DecodeChunk(pending, u8);
            out += dec.text;
            pending = dec.pending;
            got = u8.length;
          } else {
            const s = String(r.data == null ? '' : r.data);
            const clen = parseInt(pickHeader(r.headers, 'content-length'));
            got = !isNaN(clen) && clen > 0 ? clen : utf8Len(s);
            out += s;
          }
          if (bi === 0 && !total) {
            /* 首块 Content-Range: bytes 0-8191/123456 → 解析总大小供进度显示 */
            const cr = String(pickHeader(r.headers, 'content-range') || '');
            const slash = cr.indexOf('/');
            const t = slash >= 0 ? parseInt(cr.slice(slash + 1)) : NaN;
            if (!isNaN(t) && t > 0) total = t;
          }
          if (typeof onProgress === 'function') {
            try {
              onProgress(offset + got, total);
            } catch (e) {/* 进度回调不影响主流程 */}
          }
          if (got <= 0 || got < RAW_CHUNK) {
            complete = true;
            _interrupt7 = true;
            return;
          }
          offset += got;
        }
        const _temp113 = function () {
          if (bi === 0 && mode === 'arraybuffer' && (typeof r.data === 'string' && !(r.data instanceof Uint8Array) || r.data == null)) {
            mode = 'text';
            return Promise.resolve(rawRangeRetry(url, offset, offset + RAW_CHUNK - 1, mode)).then(function (_rawRangeRetry) {
              r = _rawRangeRetry;
            });
          }
        }();
        /* 首块探测：平台不支持 arraybuffer（回调给字符串）→ 全程换文本模式重取本块；
         * v1.2.1：arraybuffer 请求直接抛错（固件不支持）→ 同样换文本模式重试 */
        return _temp113 && _temp113.then ? _temp113.then(_temp114) : _temp114(_temp113);
      });
    });
    return Promise.resolve(_temp115 && _temp115.then ? _temp115.then(_temp116) : _temp116(_temp115));
  } catch (e) {
    return Promise.reject(e);
  }
};
/** 块级重试（v1.2.1）：单块网络抖动/瞬时 5xx 重试一次（800ms 退避），
 *  避免大文件几十块取到 90% 时一块失败全盘报废 */
const rawRangeRetry = function (url, start, end, mode) {
  try {
    let _exit27 = false,
      _interrupt6 = false;
    function _temp112(_result47) {
      if (_exit27) return _result47;
      throw e0;
    }
    let e0 = null;
    let i = 0;
    const _temp111 = _for(function () {
      return !(_interrupt6 || _exit27) && i < 2;
    }, function () {
      return i++;
    }, function () {
      return _catch(function () {
        return Promise.resolve(rawRangeOnce(url, start, end, mode)).then(function (_await$rawRangeOnce) {
          _exit27 = true;
          return _await$rawRangeOnce;
        });
      }, function (e) {
        e0 = e;
        if (i > 0) {
          _interrupt6 = true;
          return;
        }
        return Promise.resolve(new Promise(r => setTimeout(r, 800))).then(function () {});
      });
    });
    return Promise.resolve(_temp111 && _temp111.then ? _temp111.then(_temp112) : _temp112(_temp111));
  } catch (e) {
    return Promise.reject(e);
  }
};
/** 首块二进制嗅探（v1.2.1）：NUL 字节 = 二进制文件，立即报错而非渲染乱码 */
const rawRangeOnce = function (url, start, end, mode) {
  try {
    let _exit26 = false,
      _interrupt5 = false;
    function _temp110(_result45) {
      if (_exit26) return _result45;
      if (!res) throw {
        status: 0,
        message: '网络连接失败，请检查手表网络'
      };
      return {
        code: Number(res.code) || 0,
        data: res.data,
        headers: res.headers
      };
    }
    const header = {
      'User-Agent': 'vela-github-client',
      Accept: 'application/octet-stream',
      Range: 'bytes=' + start + '-' + end
    };
    if (_token) header['Authorization'] = 'Bearer ' + _token;
    // v1.2.3：URL 扰动（每块起始偏移作为扰动参数）——绕开真机蓝牙代理对
    // 同一 URL 连续请求的缓存/去重拦截（Range 头不同的同 URL 第 2 块必失败实证）
    const reqUrl = rawChunkUrl(url, start);
    let res = null;
    let attempt = 0;
    const _temp109 = _for(function () {
      return !(_interrupt5 || _exit26) && attempt < 2;
    }, function () {
      return attempt++;
    }, function () {
      return _catch(function () {
        return Promise.resolve(rawFetch({
          url: reqUrl,
          method: 'GET',
          header: header,
          rt: mode,
          timeout: 15000
        })).then(function (_rawFetch4) {
          res = _rawFetch4;
          _interrupt5 = true;
        });
      }, function () {
        if (attempt > 0) throw {
          status: 0,
          message: '网络连接失败，请检查手表网络'
        };
      });
    });
    return Promise.resolve(_temp109 && _temp109.then ? _temp109.then(_temp110) : _temp110(_temp109));
  } catch (e) {
    return Promise.reject(e);
  }
};
const requestAdaptive = function (key, build, page) {
  try {
    let _exit25 = false;
    function _temp108(_result43) {
      if (_exit25) return _result43;
      _adaptPer[key] = ADAPT_LADDER[ADAPT_LADDER.length - 1];
      throw lastErr;
    }
    let lastErr = null;
    if (!page || page <= 1) delete _adaptPer[key];
    const start = Math.max(0, ADAPT_LADDER.indexOf(_adaptPer[key]));
    let i = start;
    const _temp107 = _for(function () {
      return !_exit25 && i < ADAPT_LADDER.length;
    }, function () {
      return i++;
    }, function () {
      const per = ADAPT_LADDER[i];
      return _catch(function () {
        return Promise.resolve(request(build(per))).then(function (d) {
          _adaptPer[key] = per;
          _lastListPerPage = per;
          _exit25 = true;
          return d;
        });
      }, function (e) {
        lastErr = e;
        // 仅对「确定性截断」降档；网络失败/限流/404 降档无意义，直接抛
        if (!e || !e.incomplete) throw e;
      });
    });
    return Promise.resolve(_temp107 && _temp107.then ? _temp107.then(_temp108) : _temp108(_temp107));
  } catch (e) {
    return Promise.reject(e);
  }
};
/* ================= v1.2.0 raw Range 分块拉取 =================
 * raw.githubusercontent.com 实证支持 HTTP Range（206 + accept-ranges: bytes），
 * api.github.com git/blobs 实证不支持（Range 被忽略返回 200 全量）。
 * v1.2.3 根治「第 2 块起必失败」：真机蓝牙代理对**同一 URL 的连续请求**存在
 * 缓存/去重行为——第 1 块成功后，第 2 块请求被代理拦截（fail 回调），分块链
 * 第 2 块起必失败。方案：每块 URL 追加无害扰动参数 ?_b=<offset>（服务器忽略
 * 未知 query，内容不变），代理视为不同请求逐块放行。
 * v1.2.3 块大小 8192→12288（仍低于 14.3KB 实测截断下限）：块数少 33%，
 * 弱网下总往返显著减少。UTF-8 多字节字符可能被块边界切开：字节模式用跨块
 * 状态机解码（pending 字节留到下一块）；平台不支持 arraybuffer 时退化为文本
 * 模式（边界字符损坏概率极低，且比「整个响应截断」好一个数量级）。 */
const requestGo = function (url, header, opt) {
  try {
    let _exit22 = false,
      _interrupt4 = false;
    function _temp106(_result37) {
      let _exit24 = false;
      if (_exit22) return _result37;
      function _temp104(_result41) {
        if (_exit24) return _result41;
        const status = Number(res.code) || 0;
        // v1.2.1：304 Not Modified —— 服务器确认内容未变，直接用缓存（几十字节替代全量）
        // v1.2.1：成功响应写入缓存（GET JSON/raw；data 为空不缓存防毒化）
        // v1.2.3：空串 '' 同样不缓存 —— raw 空体响应 data='' 会毒化同 URL 的
        // 后续不同形态请求（如通道④ raw 空体后通道⑤ JSON 复用同一 URL 命中坏缓存）
        if (status === 304) {
          if (stale) {
            memTouch(url);
            return stale.data;
          }
          throw {
            status: 304,
            message: '内容未变化（304）但本地无缓存'
          };
        }
        const remaining = parseInt(pickHeader(res.headers, 'x-ratelimit-remaining'));
        if (!isNaN(remaining)) _rate.remaining = remaining;
        const limit = parseInt(pickHeader(res.headers, 'x-ratelimit-limit'));
        if (!isNaN(limit)) _rate.limit = limit;
        if (status < 200 || status >= 300) {
          const ghMsg = data && data.message ? data.message : '';
          throw {
            status: status,
            message: friendlyMessage(status, ghMsg)
          };
        }
        if ((opt.method || 'GET') === 'GET' && data !== null && data !== undefined && data !== '') {
          memSet(url, data, pickHeader(res.headers, 'etag'));
        }
        return data;
      }
      const _temp103 = function () {
        if (!res) {
          function _temp102(_result40) {
            if (_exit24) return _result40;
            // v1.2.1：代理把 304/超时当传输层失败且重试耗尽 → 有旧缓存则回退（旧数据好过报错）
            const sc2 = _mem.map[url];
            if (sc2 && sc2.data !== null && sc2.data !== undefined && (!Array.isArray(sc2.data) || sc2.data.length > 0)) {
              const _sc2$data = sc2.data;
              _exit24 = true;
              return _sc2$data;
            }
            throw {
              status: 0,
              message: '网络连接失败，请检查手表网络（运动健康蓝牙代理 / eSIM）'
            };
          }
          const _temp101 = function () {
            if (lastErr && lastErr.incomplete) {
              function _temp100(_result39) {
                if (_exit24) return _result39;
                // v1.2.1：下载通道也失败 → 若本会话曾成功取回该 URL，回退旧缓存（旧数据好过报错）
                const sc = _mem.map[url];
                if (sc && sc.data !== null && sc.data !== undefined && (!Array.isArray(sc.data) || sc.data.length > 0)) {
                  const _sc$data = sc.data;
                  _exit24 = true;
                  return _sc$data;
                }
                // v1.1.3：incomplete 标志供自适应分页降档重试（确定性截断靠同参重试无解）
                throw {
                  status: lastStatus,
                  incomplete: true,
                  message: '响应数据不完整（代理长响应受限' + (lastBody ? '，残片 ' + lastBody.length + 'B' : '') + (lastStatus ? '，HTTP ' + lastStatus : '') + '），请重试'
                };
              }
              // v1.4.0：截断数组抢救（opt.salvage 开启时）——从残缺 JSON 恢复前导完整条目，
              // 调用方（notifSubPage）按已得条数补拉尾部。部分数据优于全损且零额外耗时。
              if (opt.salvage && !opt.raw && lastBody) {
                const sv = salvageJsonArray(lastBody);
                if (sv) {
                  salvageMark(url, sv.arr.length);
                  /* v1.5.0：绝不能把抢救出的部分数组写入缓存——旧版 memSet(url, sv.arr)
                   * 把残缺列表当完整结果缓存，TTL 内重进页面命中缓存直接返回残片，
                   * salvage 记录又已过期 → 静默缺条且无任何提示（真机体感「不完整」）。
                   * 部分数据只经返回值交给调用方即时补拉，缓存只存完整响应。 */
                  const _sv$arr = sv.arr;
                  _exit24 = true;
                  return _sv$arr;
                }
              }
              // v1.1.4：incomplete 时先走下载通道兜底（GET 的 JSON/raw；
              // 原生下载器与 fetch 不同路，可能不受蓝牙代理截断影响；
              // v1.2.1：不带 If-None-Match，避免下载器收到 304 空文件）
              const _temp99 = function () {
                if ((opt.method || 'GET') === 'GET' && !opt.noDl) {
                  const dh = {};
                  for (const hk in header) {
                    if (hk !== 'If-None-Match') dh[hk] = header[hk];
                  }
                  return _catch(function () {
                    return Promise.resolve(dlFetchText(url, dh)).then(function (text) {
                      if (text && text.length) {
                        const cleaned = String(text).replace(/^\uFEFF/, '').trim();
                        if (opt.raw) {
                          _exit24 = true;
                          return cleaned;
                        }
                        const d2 = JSON.parse(cleaned);
                        memSet(url, d2, '');
                        _exit24 = true;
                        return d2;
                      }
                    });
                  }, function () {});
                }
              }();
              return _temp99 && _temp99.then ? _temp99.then(_temp100) : _temp100(_temp99);
            }
          }();
          return _temp101 && _temp101.then ? _temp101.then(_temp102) : _temp102(_temp101);
        }
      }();
      return _temp103 && _temp103.then ? _temp103.then(_temp104) : _temp104(_temp103);
    }
    let res = null;
    let data = null;
    let lastErr = null;
    let lastStatus = 0;
    let lastBody = ''; /* v1.4.0：截断原文留存，供抢救解析 */
    // v1.2.1：ETag 条件请求 —— 缓存过期后复验，304 只回响应头
    const stale = _mem.map[url];
    // 防御性重试（模拟器实测连续请求偶发 fail；真机弱网同样受益）：1.2s / 2.4s 两次退避
    // v1.1.1：JSON 解析失败 / GET 200 空响应体（蓝牙代理对长响应截断/丢弃）同样纳入可重试失败
    // v1.1.3：新增 content-length 对照检测——raw 文本被静默截断时 JSON.parse 不会报错，
    //         页面会渲染残缺内容（比报错更糟）；真机 README 14.3KB 可达，阈值在其之上
    let attempt = 0;
    const _temp105 = _for(function () {
      return !(_interrupt4 || _exit22) && attempt < 3;
    }, function () {
      return attempt++;
    }, function () {
      function _temp98() {
        let _exit23 = false;
        function _temp96(_result36) {
          if (_exit23) return _result36;
          lastStatus = Number(res.code) || 0;
          let d = res.data;
          if (typeof d === 'string') {
            const s = d.replace(/^\uFEFF/, '').trim();
            if (opt.raw) {
              // v1.1.3：raw 文本截断检测（content-length 存在且未压缩时才比对；
              // 字节估算兼容多字节字符，避免中文内容误判）
              const clen = parseInt(pickHeader(res.headers, 'content-length'));
              const enc = pickHeader(res.headers, 'content-encoding');
              if (!isNaN(clen) && clen > 0 && !enc) {
                let bytes = 0;
                for (let bi = 0; bi < s.length; bi++) {
                  const c = s.charCodeAt(bi);
                  bytes += c < 0x80 ? 1 : c < 0x800 ? 2 : 3;
                }
                if (bytes + 8 < clen) {
                  // v1.2.3：确定性截断（content-length 实证缺失）——同参重试无解，
                  // 立即跳出重试循环走下载器兜底/降档，不再空耗 1.2s+2.4s
                  lastErr = {
                    incomplete: true
                  };
                  res = null;
                  _interrupt4 = true;
                  return;
                }
              }
              d = s;
            } else if (s.length > 0) {
              try {
                d = JSON.parse(s);
              } catch (e) {
                // 截断的 JSON：绝不能把残缺文本当数据返回给页面。
                // v1.2.4：截断/垃圾 JSON 属「歧义失败」——真机实测同一 URL 重试偶发可过
                //（蓝牙代理偶发吐半截/垃圾体），v1.2.3 的 1 次快速终止把可恢复故障变成
                // 硬错误，是通知页「响应数据不完整」高频复现的共因。给 1 次重试再判死；
                // raw content-length 实证截断（下方独立分支）仍是确定性截断，1 次终止。
                // v1.4.0：留存原文供循环结束后抢救解析（opt.salvage 开启时）。
                lastBody = s;
                lastErr = {
                  incomplete: true
                };
                res = null;
                if (attempt >= 1) {
                  _interrupt4 = true;
                  return;
                }
                return;
              }
            } else {
              d = null;
            }
          }
          // v1.2.2：GET 200 空响应体一律重试——raw 文本空体同样命中（蓝牙代理对大文件
          // 偶发回 200 + 空体，v1.2.1 及之前被当「成功空内容」返回，页面报「文件内容为空」）。
          // 守卫 lastStatus===200：304（无 body 属正常，复验命中）绝不能进重试
          if ((opt.method || 'GET') === 'GET' && lastStatus === 200 && (d === null || d === undefined || opt.raw && typeof d === 'string' && d.length === 0)) {
            // GET 期望 JSON 却拿到空体：蓝牙代理丢长响应的典型表现，重试
            lastErr = {
              incomplete: true
            };
            res = null;
            return;
          }
          data = d;
          _interrupt4 = true;
        }
        const _temp95 = _catch(function () {
          const sendHeader = stale && stale.etag && (opt.method || 'GET') === 'GET' ? Object.assign({}, header, {
            'If-None-Match': stale.etag
          }) : header;
          return Promise.resolve(rawFetch({
            url: url,
            method: opt.method || 'GET',
            header: sendHeader,
            data: opt.body ? JSON.stringify(opt.body) : undefined,
            raw: !!opt.raw /* v1.2.3：透传 raw 标志给 rawFetch（text responseType 强制） */
          })).then(function (_rawFetch3) {
            res = _rawFetch3;
          });
        }, function (e) {
          lastErr = e;
          res = null;
          // Vela fetch_impl 把 HTTP 403/429 也当传输层错误抛出（upload err, error code: 403）：
          // 限流类失败重试无意义，直接给出友好文案（VM 实测：游客 60 次/时耗尽即此形态）
          const es = JSON.stringify(e && e.message !== undefined ? e.message : e || '');
          const ec = Number(e && (e.code || e.errorCode || e.status)) || (/403|rate limit/i.test(es) ? 403 : 0);
          if (ec === 403 || ec === 429) {
            throw {
              status: ec,
              message: 'GitHub 接口限流：游客每小时 60 次，建议在设置中填入 Token（5000 次/小时）'
            };
          }
        });
        return _temp95 && _temp95.then ? _temp95.then(_temp96) : _temp96(_temp95);
      }
      const _temp97 = function () {
        if (attempt > 0) return Promise.resolve(new Promise(resolve => setTimeout(resolve, attempt === 1 ? 1200 : 2400))).then(function () {});
      }();
      return _temp97 && _temp97.then ? _temp97.then(_temp98) : _temp98(_temp97);
    });
    return Promise.resolve(_temp105 && _temp105.then ? _temp105.then(_temp106) : _temp106(_temp105));
  } catch (e) {
    return Promise.reject(e);
  }
};
/* ---------------- 自适应分页（v1.1.3） ----------------
 * 真机实测：README 14.3KB 完整可达，42KB 发行版列表必截断 —— 蓝牙代理对长响应
 * 存在确定性截断阈值（≥14.3KB，<42KB），同参重试永远失败。唯一解：缩小响应体。
 * 列表端点逐级降 per_page（10→4→1），单条最大响应可控在阈值之下。
 * 最后生效的 per_page 由 lastListPerPage() 供页面做 hasMore 判断。
 */
/**
 * 统一请求：path 以 / 开头（相对 api.github.com），或传完整 URL
 * v1.2.1：外层负责缓存命中 / 单飞去重，内层 requestGo 负责网络与重试
 * @returns Promise<any> 解析后的 JSON 数据
 * @reject {status, message}
 */
export const request = function (path, options) {
  try {
    // ★ 每页 JS context 独立持有本模块实例（_token 不共享），
    //   页面若未先调 loadToken() 会以匿名身份发请求——匿名限流 60/h 且
    //   实测被无效请求耗尽后全 403。统一在请求入口确保 Token 已加载。
    return Promise.resolve(loadToken()).then(function () {
      const opt = options || {};
      let url = path.indexOf('https://') === 0 ? path : API_BASE + path;
      const header = {
        'User-Agent': 'vela-github-client',
        Accept: opt.raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      };
      for (const hk in H_IDENTITY) header[hk] = H_IDENTITY[hk];
      if (_token) header['Authorization'] = 'Bearer ' + _token;
      if (opt.method && opt.body) header['Content-Type'] = 'application/json';
      const isGet = (opt.method || 'GET') === 'GET';
      if (isGet && !opt.noCache) {
        const hit = memGet(url);
        if (hit && hit.fresh) return hit.data;
        if (_mem.inflight[url]) return _mem.inflight[url];
        /* 手环9老引擎无 Promise.prototype.finally，用 then/catch 等价实现 */
        const p = requestGo(url, header, opt).then(
          (v) => { delete _mem.inflight[url]; return v; },
          (e) => { delete _mem.inflight[url]; throw e; }
        );
        _mem.inflight[url] = p;
        return p;
      }
      return requestGo(url, header, opt);
    });
  } catch (e) {
    return Promise.reject(e);
  }
};
const ghql = function (query, variables) {
  try {
    return Promise.resolve(loadToken()).then(function () {
      let _interrupt3 = false;
      function _temp94() {
        if (!res) throw {
          status: 0,
          gqlSkip: true,
          message: 'GraphQL 网络失败'
        };
        const status = Number(res.code) || 0;
        const d = jsonMaybe(res);
        if (status === 401) throw {
          status: 401,
          message: 'Token 无效或已过期，请在「设置」更新'
        };
        if (status === 403 || status === 429) throw {
          status: status,
          gqlSkip: true,
          message: 'GraphQL 限流，回退 REST'
        };
        if (status < 200 || status >= 300) throw {
          status: status,
          gqlSkip: true,
          message: 'GraphQL HTTP ' + status
        };
        if (!d) throw {
          status: 200,
          gqlSkip: true,
          message: 'GraphQL 响应不完整'
        };
        if (d.errors && d.errors.length && !d.data) throw {
          status: 200,
          gqlSkip: true,
          message: d.errors[0] && d.errors[0].message || 'GraphQL 查询错误'
        };
        return d.data;
      }
      if (!_token) throw {
        status: 0,
        gqlSkip: true,
        message: '游客模式，GraphQL 不可用'
      };
      let res = null;
      let attempt = 0;
      const _temp93 = _for(function () {
        return !_interrupt3 && attempt < 3;
      }, function () {
        return attempt++;
      }, function () {
        function _temp92() {
          const _temp90 = _catch(function () {
            return Promise.resolve(rawFetch({
              url: GQL_URL,
              method: 'POST',
              header: gqlHeaders(),
              data: JSON.stringify({
                query: query,
                variables: variables || {}
              })
            })).then(function (_rawFetch2) {
              res = _rawFetch2;
              _interrupt3 = true;
            });
          }, function () {
            res = null;
          });
          if (_temp90 && _temp90.then) return _temp90.then(function () {});
        }
        const _temp91 = function () {
          if (attempt > 0) return Promise.resolve(new Promise(r => setTimeout(r, attempt === 1 ? 1200 : 2400))).then(function () {});
        }();
        return _temp91 && _temp91.then ? _temp91.then(_temp92) : _temp92(_temp91);
      });
      return _temp93 && _temp93.then ? _temp93.then(_temp94) : _temp94(_temp93);
    });
  } catch (e) {
    return Promise.reject(e);
  }
};
/** 是否回退 REST：网络失败/限流/网关/截断/游标断链 → 回退；
 *  401（token 坏）/404（仓库不存在）/422（参数错）属确定失败，直接抛给页面。 */
/** 下载通道取回响应正文（GET JSON/raw 均适用）；任何一步失败都抛错。
 *  v1.2.2：超时可调——文件主通道给足 30/45/10s（整文件落盘是慢而稳的管线），
 *  默认 8/15/5s（兜底通道不能拖死 UI，最坏 ~28s 后仍走 incomplete 报错）。 */
const dlFetchText = function (url, header, timeouts) {
  try {
    const t = timeouts || {};
    return Promise.resolve(withTimeout(dlDownload(url, header), t.download || 8000, 'download')).then(function (token) {
      if (!token) throw {
        dlErr: 'no token'
      };
      return Promise.resolve(withTimeout(dlWait(token), t.complete || 15000, 'complete')).then(function (uri) {
        if (!uri) throw {
          dlErr: 'no uri'
        };
        return Promise.resolve(withTimeout(dlRead(uri), t.read || 5000, 'read')).then(function (text) {
          // 临时文件清理（官方最佳实践：及时清理避免内存过载），失败不影响主流程
          try {
            file.delete({
              uri
            });
          } catch (e) {}
          return text;
        });
      });
    });
  } catch (e) {
    return Promise.reject(e);
  }
};
/** raw 站点错误体嗅探：raw.githubusercontent.com 对 404/403 返回纯文本
 *  「404: Not Found」等（HTTP 层可能是 200 由代理改写，或下载器拿到 200 空壳）。
 *  命中则视为该通道失败，绝不把错误体当文件内容缓存/渲染。 */
/** v1.4.0：单条缓存作废（完整性校验失败的历史截断体，重拉覆盖）；
 *  仅删索引，孤儿文件由 LRU 自然淘汰，失败不影响主流程 */
const fcacheDrop = function (url) {
  try {
    const _temp89 = _catch(function () {
      return Promise.resolve(fcacheLoad()).then(function (m) {
        const rest = m.items.filter(x => x.url !== url);
        const _temp88 = function () {
          if (rest.length !== m.items.length) {
            m.items = rest;
            return Promise.resolve(fcacheSave(m)).then(function () {});
          }
        }();
        if (_temp88 && _temp88.then) return _temp88.then(function () {});
      });
    }, function () {});
    return Promise.resolve(_temp89 && _temp89.then ? _temp89.then(function () {}) : void 0);
  } catch (e) {
    return Promise.reject(e);
  }
};
/** 按字节上限截断字符串（UTF-8 序列完整，不切多字节字符） */
/** 写入缓存（头插 + LRU 裁剪）；失败不影响主流程 */
const fcachePut = function (url, text) {
  return Promise.resolve(_catch(function () {
    return Promise.resolve(fcacheLoad()).then(function (m) {
      const fname = fhash(url);
      return Promise.resolve(fileSet(FCACHE_DIR + fname, text)).then(function () {
        function _temp87() {
          m.items = rest;
          return Promise.resolve(fcacheSave(m)).then(function () {});
        }
        const rest = m.items.filter(x => x.url !== url && x.f !== fname);
        rest.unshift({
          url: url,
          f: fname,
          bytes: utf8Len(text),
          ts: Date.now()
        });
        let bytes = 0;
        for (let i = 0; i < rest.length; i++) bytes += rest[i].bytes || 0;
        const _temp86 = _for(function () {
          return rest.length > FCACHE_MAX_FILES || bytes > FCACHE_MAX_BYTES;
        }, void 0, function () {
          const victim = rest.pop();
          bytes -= victim.bytes || 0;
          const _temp85 = _catch(function () {
            return Promise.resolve(fileRemove(FCACHE_DIR + victim.f)).then(function () {});
          }, function () {});
          if (_temp85 && _temp85.then) return _temp85.then(function () {});
        });
        return _temp86 && _temp86.then ? _temp86.then(_temp87) : _temp87(_temp86);
      });
    });
  }, function () {}));
};
/** 命中返回全文并 LRU 触碰；未命中返回 null（读失败也当未命中，下次重下） */
const fcacheGet = function (url) {
  try {
    let _exit20 = false;
    const _temp84 = _catch(function () {
      return Promise.resolve(fcacheLoad()).then(function (m) {
        let _exit21 = false;
        let i = 0;
        return _for(function () {
          return !_exit21 && i < m.items.length;
        }, function () {
          return i++;
        }, function () {
          return function () {
            if (m.items[i].url === url) {
              return Promise.resolve(fileGet(FCACHE_DIR + m.items[i].f)).then(function (txt) {
                if (!txt || !txt.length) {
                  const _temp83 = null;
                  _exit20 = true;
                  return _temp83;
                }
                m.items[i].ts = Date.now();
                fcacheSave(m);
                _exit20 = true;
                return txt;
              });
            }
          }();
        });
      });
    }, function () {});
    return Promise.resolve(_temp84 && _temp84.then ? _temp84.then(function (_result33) {
      return _exit20 ? _result33 : null;
    }) : _exit20 ? _temp84 : null);
  } catch (e) {
    return Promise.reject(e);
  }
};
const fcacheSave = function (m) {
  try {
    const _temp82 = _catch(function () {
      return Promise.resolve(fileSet(FCACHE_MANIFEST, JSON.stringify(m))).then(function () {});
    }, function () {});
    return Promise.resolve(_temp82 && _temp82.then ? _temp82.then(function () {}) : void 0);
  } catch (e) {
    return Promise.reject(e);
  }
};
const fcacheLoad = function () {
  try {
    if (_fcacheManifest) return Promise.resolve(_fcacheManifest);
    return Promise.resolve(fileGet(FCACHE_MANIFEST)).then(function (raw) {
      try {
        const m = JSON.parse(raw || '{}');
        _fcacheManifest = m && Array.isArray(m.items) ? m : {
          items: []
        };
      } catch (e) {
        _fcacheManifest = {
          items: []
        };
      }
      return _fcacheManifest;
    });
  } catch (e) {
    return Promise.reject(e);
  }
};
const rawFetch = function (opts) {
  try {
    let _exit18 = false;
    function _temp81(_result30) {
      return _exit18 ? _result30 : _catch(function () {
        return Promise.resolve(directFetch(opts));
      }, function (e) {
        let _exit19 = false;
        function _temp79(_result32) {
          if (_exit19) return _result32;
          throw e;
        }
        const _temp78 = function () {
          if (mode === 'auto' && !_bridgeSticky && bridgeReady()) {
            return _catch(function () {
              return Promise.resolve(bridgeFetch(opts)).then(function (r) {
                _bridgeSticky = true;
                _exit19 = true;
                return r;
              });
            }, function () {});
          }
        }();
        /* 直连失败且网桥就绪 → 网桥重试一次（砍网机型的根救路径） */
        return _temp78 && _temp78.then ? _temp78.then(_temp79) : _temp79(_temp78);
      });
    }
    const mode = _bridgeMode;
    if (mode === 'bridge') return Promise.resolve(bridgeFetch(opts));
    const _temp80 = function () {
      if (mode === 'auto' && (bridgeReady() || _bridgeSticky)) {
        /* 网桥优先（就绪或已粘性）：失败静默回落直连 */
        return _catch(function () {
          return Promise.resolve(bridgeFetch(opts)).then(function (r) {
            _bridgeSticky = true;
            _exit18 = true;
            return r;
          });
        }, function () {
          _bridgeSticky = false;
        });
      }
    }();
    return Promise.resolve(_temp80 && _temp80.then ? _temp80.then(_temp81) : _temp81(_temp80));
  } catch (e) {
    return Promise.reject(e);
  }
};
/* ---- v1.9.0 网桥管理（设置页消费；export {} 语法本工具链不可靠 → 包装函数） ---- */
/**
 * v1.1.3：验证任意 Token（不落盘、不污染既有登录态）。
 * 之前「先 saveToken 再验证、失败 clearToken」的顺序有两个致命伤：
 *  ① 二次输入拼接成脏 token 时 401 → clearToken 把之前存的 GOOD token 也清了 →
 *    用户被锁死在游客模式，重输又手误 → 无限循环（真机实锤）；
 *  ② 验证期间存储里已是脏 token，其它页 context 恰好发请求即携带脏值。
 * 改为：临时替换内存 token 调 /user，finally 恢复原值；验证通过才由调用方 saveToken。
 */
export const validateToken = function (token) {
  try {
    const t = (token || '').replace(/\s+/g, '');
    if (!t) throw {
      status: -1,
      message: 'Token 为空'
    };
    const prevToken = _token;
    const prevReady = _tokenReady;
    _token = t;
    _tokenReady = Promise.resolve(t);
    _self = null;
    return Promise.resolve(_finallyRethrows(function () {
      return Promise.resolve(request('/user', {
        noCache: true
      })).then(function (user) {
        if (!user || !user.login) throw {
          status: 200,
          message: '响应异常，未取到用户名'
        };
        return user;
      });
    }, function (_wasThrown, _result) {
      _token = prevToken;
      _tokenReady = prevReady;
      _self = null;
      if (_wasThrown) throw _result;
      return _result;
    }));
  } catch (e) {
    return Promise.reject(e);
  }
};

/** Token 格式诊断：返回空串=格式正常，否则给出可读提示（不发请求） */
/** v1.1.4：读回验证（登录后立即确认两通道是否真的存上了） */
export const verifyPersisted = function () {
  try {
    return Promise.resolve(stGet(TOKEN_KEY)).then(function (s) {
      return Promise.resolve(fileGet(TOKEN_FILE)).then(function (f) {
        _persistDiag.storage = typeof s === 'string' ? s.length : 0;
        _persistDiag.file = typeof f === 'string' ? f.length : 0;
        return {
          storage: !!s,
          file: !!f
        };
      });
    });
  } catch (e) {
    return Promise.reject(e);
  }
};
export const clearToken = function () {
  return saveToken('');
};
export const saveToken = function (token) {
  try {
    function _temp4() {
      // 同步进程内缓存（否则本 context 后续 loadToken 仍返回旧值）；
      // 同时撤销缓存态：确保后续 loadToken(true/false) 都能拿到最新值
      _tokenReady = Promise.resolve(_token);
      _self = null;
      clearCache(); /* v1.2.1：token 变更全清缓存（不同身份的数据不可复用） */
      _persistDiag.storage = r.storage ? _token.length : 0;
      _persistDiag.file = r.file ? _token.length : 0;
      _persistDiag.write = _token ? r.storage && r.file ? '双通道√' : r.storage ? '仅storage' : r.file ? '仅file' : '双通道均失败' : '已清除';
      return _token;
    }
    _token = (token || '').trim();
    let r = {
      storage: false,
      file: false
    };
    const _temp3 = function () {
      if (_token) {
        return Promise.resolve(persistToken(_token)).then(function (_persistToken) {
          r = _persistToken;
        });
      } else {
        return Promise.resolve(unpersistToken()).then(function () {});
      }
    }();
    return Promise.resolve(_temp3 && _temp3.then ? _temp3.then(_temp4) : _temp4(_temp3));
  } catch (e) {
    return Promise.reject(e);
  }
};
const unpersistToken = function () {
  try {
    function _temp77() {
      const _temp75 = _catch(function () {
        return Promise.resolve(fileRemove(TOKEN_FILE)).then(function () {});
      }, function () {});
      if (_temp75 && _temp75.then) return _temp75.then(function () {});
    }
    const _temp76 = _catch(function () {
      return Promise.resolve(stRemove(TOKEN_KEY)).then(function () {});
    }, function () {});
    return Promise.resolve(_temp76 && _temp76.then ? _temp76.then(_temp77) : _temp77(_temp76));
  } catch (e) {
    return Promise.reject(e);
  }
};
/** 双通道写入：storage 失败不影响 file 兜底，两通道全失败才判定不落盘。
 *  返回 {storage, file} 两通道是否成功（字符长度记入诊断）。 */
const persistToken = function (t) {
  try {
    function _temp74() {
      const _temp72 = _catch(function () {
        return Promise.resolve(fileSet(TOKEN_FILE, t)).then(function () {
          r.file = true;
        });
      }, function () {
        r.file = false;
      });
      return _temp72 && _temp72.then ? _temp72.then(function () {
        return r;
      }) : r;
    }
    const r = {
      storage: false,
      file: false
    };
    const _temp73 = _catch(function () {
      return Promise.resolve(stSet(TOKEN_KEY, t)).then(function () {
        r.storage = true;
      });
    }, function () {
      r.storage = false;
    });
    return Promise.resolve(_temp73 && _temp73.then ? _temp73.then(_temp74) : _temp74(_temp73));
  } catch (e) {
    return Promise.reject(e);
  }
};
const API_BASE = 'https://api.github.com';
const TOKEN_KEY = 'gh_token';
const TOKEN_FILE = 'internal://files/gh_token.txt';
const PER_PAGE = 10;
/* v1.4.0：Accept-Encoding: identity —— 真机实测截断只出现在 api.github.com 的
 * 分块/压缩流（通知 per=1 6.3KB 偶断、目录 6KB 偶断），而 content-length 明确的
 * identity 流（README 14.3KB、下载器整文件）可达远超 8KB。显式要 identity 让
 * JSON 响应带上确定长度，与下载器同形态——若代理尊重此头，截断阈值直接抬到
 * 14KB+（README 实证）；不尊重则无害回退原形态。 */
const H_IDENTITY = {
  'Accept-Encoding': 'identity'
};

/* ---------------- v1.4.0：截断 JSON 抢救解析 ----------------
 * 蓝牙代理对长数组响应确定性截断（尾部半截），JSON.parse 整体失败 →
 * 原版丢弃全部数据重拉。实际上截断点之前的前导完整对象可无损恢复：
 * 深扫到最后一个顶层完整 '}'，截断前缀 + ']' 解析即得部分数据。
 * 仅用于通知管线（notifSubPage 会按长度补拉尾部，部分数据优于全损）；
 * 目录/树不启用（静默缺条比报错更糟，走 getTreeEx 下载器整树）。 */
/* v1.5.0：_lastSalvage 单例改按 URL 记键（容量 12 的最近表）——
 * 原版是并发竞态重灾区：通知子页并发 3 拉取，A/B 相继截断抢救后
 * _lastSalvage 只剩 B 的记录，A 的 notifSubPage 查到 B 的 URL 不匹配 →
 * 误判「非截断」跳过尾条补拉 → 静默丢一半条目（真机「依旧不完整」主因之一）。
 * 沙箱无截断故 e2e 测不出；真机 per=2 全部命中。 */
const _lastSalvages = {};

/** 无参返回最近一次抢救（旧用例兼容）；传 URL 返回该 URL 的记录 */
export function lastSalvageInfo(url) {
  if (url) return _lastSalvages[url] || null;
  let best = null;
  for (const k in _lastSalvages) {
    const v = _lastSalvages[k];
    if (!best || v.ts > best.ts) best = v;
  }
  return best;
}
function salvageMark(url, got) {
  const keys = Object.keys(_lastSalvages);
  if (keys.length >= 12) {
    keys.sort((a, b) => _lastSalvages[a].ts - _lastSalvages[b].ts);
    for (let i = 0; i < 4; i++) delete _lastSalvages[keys[i]];
  }
  _lastSalvages[url] = {
    url: url,
    got: got,
    ts: Date.now()
  };
}
function salvageJsonArray(s) {
  try {
    if (s.charAt(0) !== '[') return null;
    let depth = 0;
    let inStr = false;
    let esc = false;
    let last = -1;
    for (let i = 0; i < s.length; i++) {
      const c = s.charAt(i);
      if (inStr) {
        if (esc) {
          esc = false;
          continue;
        }
        if (c === '\\') {
          esc = true;
          continue;
        }
        if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') {
        inStr = true;
        continue;
      }
      if (c === '{') {
        depth++;
        continue;
      }
      if (c === '}') {
        depth--;
        if (depth === 0) last = i;
        if (depth < 0) return null;
      }
    }
    if (last <= 0) return null;
    const arr = JSON.parse(s.slice(0, last + 1) + ']');
    return Array.isArray(arr) && arr.length ? {
      arr: arr,
      partial: true
    } : null;
  } catch (e) {
    return null;
  }
}

/* ---------------- 存储层（Promise 化，v1.1.4 双通道） ----------------
 * 真机（RW5）实测：storage.set 回调 success 后，另页 context 读不到、大退后丢失
 * （v1.1.2 模拟器同路径验证是好的，属固件差异）。参考 TG Wear/BandQQ 等成熟
 * Vela 应用均把关键状态放在手机端，手表端持久化尽量少用——本应用无手机端，
 * 故采用 storage + file 双通道互为备份，读回验证，settings 页诊断可见。 */

function stGet(key) {
  return new Promise(resolve => {
    try {
      storage.get({
        key,
        success: d => resolve(d == null ? '' : d),
        fail: () => resolve('')
      });
    } catch (e) {
      resolve('');
    }
  });
}
function stSet(key, value) {
  return new Promise((resolve, reject) => {
    try {
      storage.set({
        key,
        value,
        success: () => resolve(true),
        fail: (d, c) => reject({
          d,
          c
        })
      });
    } catch (e) {
      reject(e);
    }
  });
}
function stRemove(key) {
  return new Promise(resolve => {
    try {
      storage.delete({
        key,
        success: resolve,
        fail: resolve
      });
    } catch (e) {
      resolve();
    }
  });
}

/* file 通道：internal://files 常驻分区，writeText 文件不存在会自建 */
function fileGet(uri) {
  return new Promise(resolve => {
    try {
      file.readText({
        uri,
        success: d => resolve(typeof d === 'string' ? d : d && d.text || ''),
        fail: () => resolve('')
      });
    } catch (e) {
      resolve('');
    }
  });
}
function fileSet(uri, text) {
  return new Promise((resolve, reject) => {
    try {
      file.writeText({
        uri,
        text,
        success: () => resolve(true),
        fail: (d, c) => reject({
          d,
          c
        })
      });
    } catch (e) {
      reject(e);
    }
  });
}
function fileRemove(uri) {
  return new Promise(resolve => {
    try {
      file.delete({
        uri,
        success: resolve,
        fail: resolve
      });
    } catch (e) {
      resolve();
    }
  });
}

/* ---------------- Token 管理 ---------------- */

let _token = '';
let _tokenReady = null;

/** 读取本地 Token（进程内缓存一次）
 *  v1.1.2：本固件每页 JS context 独立持有本模块副本，saveToken 只能重置当前页的
 *  _tokenReady，其它存活页面的缓存仍指向旧值（实机实证：登录成功后设置页仍显示
 *  游客模式）。force=true 时强制重读存储——需要在 onShow 感知登录态变化的页面
 *  （settings/profile/input）必须传 force。 */
export function loadToken(force) {
  if (force) _tokenReady = null;
  if (_tokenReady) return _tokenReady;
  _tokenReady = function () {
    try {
      // 双通道读取：storage 优先，空则 file 兜底（真机 storage 通道不可靠）
      return Promise.resolve(stGet(TOKEN_KEY)).then(function (v) {
        function _temp2() {
          _token = typeof v === 'string' ? v : v ? String(v) : '';
          if (!_token) src = '';
          _persistDiag.storage = src === 'storage' ? _token.length : 0;
          _persistDiag.file = src === 'file' ? _token.length : 0;
          _persistDiag.src = src;
          return _token;
        }
        let src = 'storage';
        const _temp = function () {
          if (!v || typeof v !== 'string' || !v.length) {
            return Promise.resolve(fileGet(TOKEN_FILE)).then(function (_fileGet) {
              v = _fileGet;
              src = 'file';
            });
          }
        }();
        return _temp && _temp.then ? _temp.then(_temp2) : _temp2(_temp);
      });
    } catch (e) {
      return Promise.reject(e);
    }
  }();
  return _tokenReady;
}
export function hasToken() {
  return !!_token;
}

/** 当前 Token（仅用于打码展示） */
export function currentToken() {
  return _token;
}

/* 持久化诊断（settings 页展示 + input 页登录后读回验证） */
let _persistDiag = {
  storage: 0,
  file: 0,
  src: '',
  write: ''
};
export function storageDiag() {
  return {
    storage: _persistDiag.storage,
    file: _persistDiag.file,
    src: _persistDiag.src,
    write: _persistDiag.write
  };
}
export function tokenFormatHint(token) {
  const t = (token || '').replace(/\s+/g, '');
  if (!t) return '还没有输入内容';
  if (t.indexOf('ghp_') === 0) {
    if (t.length !== 40) return '当前 ' + t.length + ' 位，标准 ghp_ 令牌为 40 位，请检查大小写/漏字';
    if (!/^[A-Za-z0-9]{36}$/.test(t.slice(4))) return '含非法字符，令牌只含字母数字，请检查';
    return '';
  }
  if (t.indexOf('github_pat_') === 0) {
    if (t.length < 80) return '当前 ' + t.length + ' 位，github_pat_ 令牌约 93 位，请检查漏字';
    return '';
  }
  if (t.indexOf('gho_') === 0 || t.indexOf('ghu_') === 0 || t.indexOf('ghs_') === 0 || t.indexOf('ghr_') === 0) {
    return '';
  }
  return '令牌应以 ghp_ 或 github_pat_ 开头，当前开头：' + t.slice(0, 4);
}

/* ---------------- 限流状态（展示用） ---------------- */

let _rate = {
  remaining: -1,
  limit: -1
};
export function rateInfo() {
  return _rate;
}

/* ---------------- fetch Promise 封装 ---------------- */

/* v1.2.1：显式超时（25s）——蓝牙代理偶发挂起时不再无限等待页面卡死，
 * 超时按网络失败走重试/报错路径 */
const FETCH_TIMEOUT = 25000;

/* ==================== v1.9.0 AstroBox 网桥（FetchBridge）传输编排 ====================
 * 三模式（持久化 gh_bridge_mode）：
 *  auto（默认）——直连优先；直连失败（无网/机型砍网）且网桥就绪 → 网桥重试；
 *              网桥成功后置 _bridgeSticky，后续请求网桥优先（省去每次先失败等超时）
 *  direct ——强制直连（行为与 v1.8 完全一致）
 *  bridge ——强制网桥（砍网机型在设置里选它，直连栈完全不参与）
 * 网桥故障（未连接/超时）在 auto 下自动回落直连，不阻塞原有链路。 */
const BRIDGE_MODE_KEY = 'gh_bridge_mode';
let _bridgeMode = 'auto';
let _bridgeModeLoaded = false;
let _bridgeSticky = false;
stGet(BRIDGE_MODE_KEY).then(v => {
  if (v === 'auto' || v === 'direct' || v === 'bridge') {
    _bridgeMode = v;
    _bridgeModeLoaded = true;
  }
}).catch(() => {});
function bridgeMode() {
  return _bridgeMode;
}
function setBridgeMode(m) {
  if (m !== 'auto' && m !== 'direct' && m !== 'bridge') return;
  _bridgeMode = m;
  _bridgeModeLoaded = true;
  _bridgeSticky = false;
  stSet(BRIDGE_MODE_KEY, m).catch(() => {});
}
function directFetch(opts) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        reject({
          timeout: true,
          message: '响应超时'
        });
      }
    }, opts.timeout || FETCH_TIMEOUT);
    try {
      fetch.fetch({
        url: opts.url,
        method: opts.method || 'GET',
        header: opts.header || {},
        data: opts.data,
        // v1.2.3：raw 请求强制 text —— responseType:'json' 时引擎会把 JSON
        // 文件（package.json 等）内容 parse 成对象回调，raw 分支 String() 化
        // 变成 '[object Object]' 并毒化 fcache（e2e 实测）；
        // README 等非 JSON 文本此前未触发是因为引擎 parse 失败回传原文
        responseType: opts.rt || (opts.raw ? 'text' : 'json'),
        success: res => {
          if (!done) {
            done = true;
            clearTimeout(timer);
            resolve(res);
          }
        },
        fail: (err, code) => {
          if (!done) {
            done = true;
            clearTimeout(timer);
            reject({
              err: err,
              code: code
            });
          }
        }
      });
    } catch (e) {
      if (!done) {
        done = true;
        clearTimeout(timer);
        reject(e);
      }
    }
  });
}
export function bridgeInfo() {
  const st = bridgeStats();
  return {
    mode: _bridgeMode,
    modeLoaded: _bridgeModeLoaded,
    supported: bridgeSupported(),
    ready: bridgeReady(),
    sticky: _bridgeSticky,
    neg: st.neg,
    stat: st.stat
  };
}
export function bridgeSetMode(m) {
  setBridgeMode(m);
  return bridgeInfo();
}
/** 主动补发握手 + 返回状态（设置页「检测网桥」） */
export function bridgeDetect() {
  bridgeKick0();
  return bridgeInfo();
}
/** 手机端宿主连接诊断（0 OK / 204 超时 / 1001 未安装 AstroBox） */
export function bridgeDiagnoseHost(timeout) {
  return bridgeDiagnose0(timeout);
}

/* ================= v1.2.1 内存缓存 + 单飞去重 + ETag 条件请求 =================
 * 手表端传输优化三件套（蓝牙代理慢、配额贵、返回导航重复全量拉取）：
 * ① TTL 缓存：GET JSON 90s、raw 文本 5min，返回导航秒开、重复请求省配额；
 * ② in-flight 去重：同 URL 并发请求合并为一次真实网络往返；
 * ③ ETag 条件请求：缓存过期后带 If-None-Match 复验，304 只回响应头（几十字节），
 *    大幅降低重进页面的传输量；代理不支持时回落 200 全量，无副作用。
 * 写操作/登录校验/限流查询一律 noCache；通知已读操作后清前缀缓存。 */
const CACHE_TTL = 90000;
const RAW_TTL = 300000;
const MEM_CAP = 40;
const _mem = {
  map: {},
  inflight: {}
};
function memGet(url, ttl) {
  const c = _mem.map[url];
  if (!c) return null;
  if (Date.now() - c.ts > (ttl || CACHE_TTL)) return {
    fresh: false,
    data: c.data,
    etag: c.etag
  };
  return {
    fresh: true,
    data: c.data
  };
}
function memSet(url, data, etag) {
  const keys = Object.keys(_mem.map);
  if (keys.length >= MEM_CAP) {
    /* 容量保护：淘汰最旧一半（手表内存有限，避免长会话无界增长） */
    keys.sort((a, b) => _mem.map[a].ts - _mem.map[b].ts);
    for (let i = 0; i < Math.ceil(keys.length / 2); i++) delete _mem.map[keys[i]];
  }
  _mem.map[url] = {
    data: data,
    etag: etag || '',
    ts: Date.now()
  };
}
function memTouch(url) {
  const c = _mem.map[url];
  if (c) c.ts = Date.now();
}

/** 清缓存：无参全清（token 变更时），带前缀则清匹配项（通知已读后） */
export function clearCache(prefix) {
  if (!prefix) {
    _mem.map = {};
    return;
  }
  for (const k in _mem.map) {
    if (k.indexOf(prefix) >= 0) delete _mem.map[k];
  }
}
function pickHeader(headers, name) {
  if (!headers) return '';
  const n = String(name).toLowerCase();
  for (const k in headers) {
    if (String(k).toLowerCase() === n) return headers[k];
  }
  return '';
}

/* ================= v1.2.2 文件磁盘缓存（弦电子书式「一次落盘、随读随取」） =================
 * 参考弦电子书（com.bandbbs.plus.ebook）chapterManager 架构：内容落盘 + 索引 +
 * TTL 内存缓存。本应用文件内容经原生下载器整文件落盘到 fcache 后可反复读——
 * 返回导航秒开、重进零传输、冷启仍有效（内存缓存 _mem 进程死即失）。
 * internal://files/fcache/<hash>.txt + m.json 清单，LRU 容量 6 文件 / 4MB。 */
const FCACHE_DIR = 'internal://files/fcache/';
const FCACHE_MANIFEST = 'internal://files/fcache/m.json';
const FCACHE_MAX_FILES = 6;
const FCACHE_MAX_BYTES = 4 * 1024 * 1024;
function fhash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h << 5) + h + s.charCodeAt(i) | 0;
  return 'f' + (h >>> 0).toString(36);
}
let _fcacheManifest = null;
function utf8SliceBytes(s, maxBytes) {
  let b = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    let w = c < 0x80 ? 1 : c < 0x800 ? 2 : 3;
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d2 = s.charCodeAt(i + 1);
      if (d2 >= 0xdc00 && d2 <= 0xdfff) w = 4;
    }
    if (b + w > maxBytes) return s.slice(0, i);
    b += w;
    if (w === 4) i++;
  }
  return s;
}

/** 有限并发映射（蓝牙代理对瞬时高并发敏感，并发压小 + 完成一个补一个） */
function mapLimit(items, limit, fn) {
  return new Promise((resolve, reject) => {
    const out = new Array(items.length);
    let next = 0;
    let done = 0;
    let failed = false;
    const launch = () => {
      if (failed || next >= items.length) return;
      const i = next++;
      fn(items[i], i).then(r => {
        if (failed) return;
        out[i] = r;
        done++;
        if (done >= items.length) resolve(out);else launch();
      }).catch(e => {
        if (failed) return;
        failed = true;
        reject(e);
      });
    };
    if (!items.length) return resolve(out);
    for (let k = 0; k < Math.min(limit, items.length); k++) launch();
  });
}

/* ---------------- 下载通道兜底（v1.1.4） ----------------
 * fetch 走蓝牙代理流式通道，大响应会被确定性截断（真机阈值 [14.3,42)KB）。
 * @system.request.download 走原生下载器管线（先落盘再回调），与 fetch 不同路；
 * 官方支持明细 REDMI Watch 5 支持。仅作 incomplete 时的兜底：
 * download → onDownloadComplete → file.readText → 解析。 */
function dlDownload(url, header) {
  return new Promise((resolve, reject) => {
    try {
      downloader.download({
        url,
        header,
        success: d => resolve(d && d.token),
        fail: (d, c) => reject({
          d,
          c
        })
      });
    } catch (e) {
      reject(e);
    }
  });
}
function dlWait(token) {
  return new Promise((resolve, reject) => {
    try {
      downloader.onDownloadComplete({
        token,
        success: d => resolve(d && d.uri),
        fail: (d, c) => reject({
          d,
          c
        })
      });
    } catch (e) {
      reject(e);
    }
  });
}
function dlRead(uri) {
  return new Promise((resolve, reject) => {
    try {
      file.readText({
        uri,
        success: d => resolve(typeof d === 'string' ? d : d && d.text || ''),
        fail: (d, c) => reject({
          d,
          c
        })
      });
    } catch (e) {
      reject(e);
    }
  });
}
function withTimeout(p, ms, tag) {
  return Promise.race([p, new Promise((resolve, reject) => setTimeout(() => reject({
    dlTimeout: tag
  }), ms))]);
}
function sniffRawErrorBody(text) {
  return /^(\d{3}):[ \r\n]/.test(String(text || '').slice(0, 16));
}

/* ================= v1.2.0 GraphQL 快车道 =================
 * 真机根因：蓝牙代理对长响应确定性截断（阈值 [14.3,42)KB）。REST 列表携带
 * 全量字段（议题带 body、仓库带 license/owner 全家桶），10 条动辄 30-60KB。
 * GraphQL 只取列表页渲染所需瘦字段，单页响应 1-3KB，从源头避开截断。
 * 任何失败（游客无 token / POST 通道异常 / 限流 / 游标断链）一律回退
 * REST 自适应分页（v1.1.3 路径），保证功能不倒退。 */

const GQL_URL = 'https://api.github.com/graphql';

/* 仓库列表瘦字段（repos/search/trending 共用；沙箱实测单页 10 条 < 2KB） */
const GQL_REPO_NODE = 'id nameWithOwner description stargazerCount forkCount isFork isPrivate pushedAt updatedAt primaryLanguage{name} owner{login}';
function gqlHeaders() {
  const h = {
    'User-Agent': 'vela-github-client',
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json'
  };
  for (const hk in H_IDENTITY) h[hk] = H_IDENTITY[hk];
  if (_token) h['Authorization'] = 'Bearer ' + _token;
  return h;
}

/* res.data 可能是对象（responseType=json）或文本（代理降级），统一归一 */
function jsonMaybe(res) {
  let d = res.data;
  if (typeof d === 'string') {
    const s = d.replace(/^\uFEFF/, '').trim();
    if (!s) return null;
    try {
      return JSON.parse(s);
    } catch (e) {
      return null;
    }
  }
  return d;
}
function gqlShouldFallback(e) {
  if (!e) return true;
  if (e.gqlSkip || e.cursorMiss || e.incomplete) return true;
  const st = Number(e.status) || 0;
  return st === 0 || st === 200 || st >= 500 || st === 403 || st === 429;
}

/* GraphQL 以游标翻页、页面以页码翻页——模块级缓存把两者串起来。
 * 断链（进程重启后直接请求第 2 页）→ undefined → 回退 REST。 */
const _gqlCursors = {};
function cursorFor(key, page) {
  if (page <= 1) return null;
  const c = _gqlCursors[key];
  if (!c || !c.cursors || typeof c.cursors[page - 1] !== 'string' || !c.cursors[page - 1]) return undefined;
  return c.cursors[page - 1];
}
function cursorSave(key, page, pageInfo) {
  const cur = pageInfo && pageInfo.endCursor ? String(pageInfo.endCursor) : '';
  const c = _gqlCursors[key] || {
    cursors: []
  };
  c.cursors[page] = cur;
  _gqlCursors[key] = c;
}

/* -------- GraphQL 节点 → REST 形状（复用 view.js 既有 mapper，页面零改动） -------- */

function gqlRepoToRest(n) {
  if (!n) return null;
  return {
    id: n.id,
    full_name: n.nameWithOwner,
    owner: {
      login: n.owner && n.owner.login || String(n.nameWithOwner || '').split('/')[0]
    },
    description: n.description || '',
    stargazers_count: n.stargazerCount || 0,
    forks_count: n.forkCount || 0,
    language: n.primaryLanguage && n.primaryLanguage.name,
    updated_at: n.pushedAt || n.updatedAt || '',
    fork: !!n.isFork,
    private: !!n.isPrivate
  };
}
function gqlIssueToRest(n) {
  if (!n) return null;
  return {
    id: n.id,
    number: n.number,
    title: n.title,
    state: String(n.state || '').toLowerCase(),
    created_at: n.createdAt || '',
    user: {
      login: n.author && n.author.login || ''
    },
    comments: n.comments && n.comments.totalCount || 0,
    labels: (n.labels && n.labels.nodes ? n.labels.nodes : []).map(l => ({
      name: l.name,
      color: l.color || ''
    }))
  };
}
function gqlReleaseToRest(n) {
  if (!n) return null;
  const ac = n.releaseAssets && n.releaseAssets.totalCount || 0;
  return {
    id: n.id,
    tag_name: n.tagName || '',
    name: n.name || '',
    body: n.description || '',
    prerelease: !!n.isPrerelease,
    published_at: n.publishedAt || '',
    created_at: n.createdAt || '',
    author: {
      login: n.author && n.author.login || ''
    },
    assets: new Array(ac)
  };
}
function dig(obj, path) {
  let cur = obj;
  for (let i = 0; i < path.length; i++) {
    if (!cur || typeof cur !== 'object') return null;
    cur = cur[path[i]];
  }
  return cur || null;
}
function friendlyMessage(status, ghMessage) {
  if (status === 401) return 'Token 无效或已过期，请在「设置」更新';
  if (status === 403) {
    /* v1.6.0：认证用户（5000/小时）撞的是二级限流/滥用拦截，旧文案「游客每小时
     * 60 次」误导用户去填 Token——按实际额度分级提示 */
    const gm = String(ghMessage || '');
    if (_rate.limit >= 5000 || /secondary|abuse|unusual/i.test(gm)) {
      return 'GitHub 限流拦截（403）：请求过于频繁，请等待 1-2 分钟后重试';
    }
    return 'GitHub 接口限流：游客每小时 60 次，建议在设置中填入 Token（5000 次/小时）';
  }
  if (status === 404) return '内容不存在（404，GitHub 路径区分大小写）';
  if (status === 422) return '请求参数错误（422）';
  if (status >= 500) return 'GitHub 服务暂时不可用（' + status + '）';
  return ghMessage || '请求失败（HTTP ' + status + '）';
}
let _lastListPerPage = PER_PAGE;
export function lastListPerPage() {
  return _lastListPerPage;
}
const ADAPT_LADDER = [10, 4, 1];

/* v1.2.1：粘性降档（跨页防错位）——列表「数据不完整」的根因修复
 * 旧行为：每页都从 per=10 重新起梯。第 1 页 10 条成功（第 1-10 条），第 2 页 10 条
 * 被截断降到 4（第 11-14 条），第 3 页 10 条又成功（第 21-30 条）→ 第 15-20 条
 * 永久丢失。改为按列表 key 记住已降档档位：同列表后续页沿用该档位绝不回升，
 * 翻页边界稳定不跳条；page<=1（下拉刷新/重新加载）重置回乐观档位。 */
const _adaptPer = {};
const RAW_BASE = 'https://raw.githubusercontent.com';
const RAW_CHUNK = 12288;
const RAW_MAX_BLOCKS = 85; /* v1.2.3：12KB × 85 ≈ 1.044MB 上限（覆盖 1MB 页面上限，与旧 8KB×128 同语义） */
const FILE_RAW_CAP = 1024 * 1024; /* v1.2.2：下载器整文件落盘后的字节上限（与页面 MAX_SIZE 对齐） */

/** v1.2.3：分块 URL 扰动——同 URL 连续请求被蓝牙代理去重/拦截的绕行。
 *  raw.githubusercontent.com 忽略未知 query 参数，内容与etag均不变。 */
function rawChunkUrl(url, blockIndex) {
  return url + (url.indexOf('?') >= 0 ? '&' : '?') + '_b=' + blockIndex;
}
function rawFileUrl(fullName, ref, path) {
  const encPath = String(path || '').split('/').map(encodeURIComponent).join('/');
  return RAW_BASE + '/' + fullName + '/' + encodeURIComponent(ref || 'HEAD') + '/' + encPath;
}
function utf8Len(s) {
  let b = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d2 = s.charCodeAt(i + 1);
      if (d2 >= 0xdc00 && d2 <= 0xdfff) {
        b += 4;
        i++;
        continue;
      }
    }
    b += c < 0x80 ? 1 : c < 0x800 ? 2 : 3;
  }
  return b;
}
function toU8(d) {
  if (d instanceof Uint8Array) return d;
  if (typeof ArrayBuffer !== 'undefined' && d instanceof ArrayBuffer) return new Uint8Array(d);
  if (d && typeof d === 'object' && d.buffer instanceof ArrayBuffer) {
    return new Uint8Array(d.buffer, d.byteOffset || 0, d.byteLength || d.buffer.byteLength);
  }
  return null;
}

/** 跨块 UTF-8 解码：prevPending 是上一块留下的不完整序列字节（0-3 个），
 *  与本块字节拼接后逐序列解码，末尾不完整序列留作下一块的 prevPending。 */
export function utf8DecodeChunk(prevPending, u8) {
  const all = [];
  for (let i = 0; i < prevPending.length; i++) all.push(prevPending[i]);
  for (let i = 0; i < u8.length; i++) all.push(u8[i]);
  let text = '';
  let i = 0;
  const n = all.length;
  while (i < n) {
    const b = all[i];
    let len = 0;
    if (b < 0x80) len = 1;else if ((b & 0xe0) === 0xc0) len = 2;else if ((b & 0xf0) === 0xe0) len = 3;else if ((b & 0xf8) === 0xf0) len = 4;else len = 1; /* 非法首字节按 latin1 输出，避免死循环 */
    if (i + len > n) break; /* 序列不完整 → 留到下一块 */
    let cp;
    if (len === 1) cp = b;else if (len === 2) cp = (b & 0x1f) << 6 | all[i + 1] & 0x3f;else if (len === 3) cp = (b & 0x0f) << 12 | (all[i + 1] & 0x3f) << 6 | all[i + 2] & 0x3f;else cp = (b & 0x07) << 18 | (all[i + 1] & 0x3f) << 12 | (all[i + 2] & 0x3f) << 6 | all[i + 3] & 0x3f;
    if (cp > 0xffff) {
      cp -= 0x10000;
      text += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    } else {
      text += String.fromCharCode(cp);
    }
    i += len;
  }
  const pending = all.slice(i);
  return {
    text: text,
    pending: pending
  };
}
function sniffBinary(u8) {
  const n = Math.min(u8.length, 512);
  for (let i = 0; i < n; i++) {
    if (u8[i] === 0) return true;
  }
  return false;
}
const README_RE = /^readme(\.(md|markdown|rst|txt|html|adoc|org|mdown|mkd))?$/i;
const DEVICE_CLIENT_LOGIN = '178c6fc778ccc68e1d6a';
const DEVICE_CLIENT_COPILOT = 'Iv1.b507a08c87ecfe98';
const DEVICE_SCOPE_LOGIN = 'repo read:user notifications';
const DEVICE_SCOPE_COPILOT = 'read:user';
const DEVICE_URL_CODE = 'https://github.com/login/device/code';
const DEVICE_URL_TOKEN = 'https://github.com/login/oauth/access_token';
function formPost(url, params) {
  const parts = [];
  for (const k in params) parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
  return new Promise((resolve, reject) => {
    try {
      fetch.fetch({
        url: url,
        method: 'POST',
        header: {
          'User-Agent': 'vela-github-client',
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        data: parts.join('&'),
        responseType: 'json',
        success: res => resolve(res),
        fail: (err, code) => reject({
          err: err,
          code: code
        })
      });
    } catch (e) {
      reject(e);
    }
  });
}
export function qs(params) {
  const parts = [];
  for (const k in params) {
    if (params[k] === undefined || params[k] === null) continue;
    parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
  }
  return parts.length ? '?' + parts.join('&') : '';
}

/* ---------------- 会话用户 ---------------- */

let _self = null;
export function getRateLimit() {
  return request('/rate_limit', {
    noCache: true
  });
}

/* ================= v1.2.2 通知并行子页（数据不完整根治） =================
 * 量化根因（v1.2.1 后真机仍不完整）：/notifications 单条 ~6KB——嵌入的 repository
 * 对象独占 5.5KB，REST 无法瘦身字段、GraphQL 又没有通知 API（schema 实证 Query
 * 根无 notifications）。
 * v1.2.2-v1.4.0 方案（5 个 per=2 子页）在真机被证伪：per=2 ~12KB 恒超蓝牙代理
 * 8KB 截断阈值 → 每次都靠抢救+尾条补拉凑齐，任意一环抖动就缺条。
 * v1.5.0 改为 per=1 主路（10 个单页，各 ~5.6KB，稳在 8KB 阈值内）并发 3 拉取：
 * 确定性截断源直接消失，salvage/下载器降级为罕见兑底而非日常路径；
 * 请求总数与旧真机实际开销（5 次 per=2 截断 + 5 次 per=1 补拉）持平。
 * gap 机制保留：单页彻底失败时留缺口渲染警告，绝不静默缺条。 */
const NOTIF_PAGE_N = 10;
/* v1.6.0：并发 3→2——10 连发经蓝牙代理打到 GitHub 易触发二级限流（403
 * abuse detection），用户体感即「响应数据不完整」；2 并发总耗时仅多 ~1.2s */
const NOTIF_CONC = 2;

/** 通知逻辑页大小（notifications.ux 的 hasMore 判断依据） */
export function notifPageSize() {
  return NOTIF_PAGE_N;
}
const NOTIF_DL_T = {
  download: 10000,
  complete: 22000,
  read: 8000
};
function notifUrl1(page, all, participating, per) {
  return '/notifications' + qs({
    page: page,
    per_page: per || 1,
    all: !!all,
    participating: participating ? true : undefined
  });
}
function notifGapable(e) {
  return !!(e && (e.incomplete || e.timeout));
}

/** 通知列表（需登录）：并行子页拼接，返回最多 notifPageSize() 条的数组。
 *  v1.2.4：截断族失败的段不再让整页报错——记入 gap 并对失败段低并发重试一轮，
 *  仍失败的段透传给页面（lastNotifGaps）渲染「部分加载」警告 + 定向重试入口；
 *  成功段照常按子页序拼接，绝不因单段故障丢弃其余 4 段数据。 */
let _lastNotifGaps = [];
export function lastNotifGaps() {
  return _lastNotifGaps;
}
export function markAllNotificationsRead() {
  return request('/notifications', {
    method: 'PUT',
    body: {}
  }).then(r => {
    clearCache('/notifications');
    return r;
  });
}

/** 单条标记已读 */
export function markThreadRead(threadUrl) {
  return request(threadUrl, {
    method: 'PUT',
    body: {}
  }).then(r => {
    clearCache('/notifications');
    return r;
  });
}

/** v1.8.0 仓库维度全部已读（开发者分仓清理）：PUT /repos/{o}/{r}/notifications。
 *  长按通知列表仓库分组头触发——一个仓库的 CI/机器人通知一次清零，不再逐条长按。 */
export function markRepoNotificationsRead(fullName) {
  return request('/repos/' + fullName + '/notifications', {
    method: 'PUT',
    body: {}
  }).then(r => {
    clearCache('/notifications');
    return r;
  });
}

/** 通知主题详情（Issue/PR/Release 的 API 地址） */
export function getSubject(url) {
  return request(url);
}
const GQL_MYREPOS_Q = 'query($first:Int!,$after:String,$order:RepositoryOrder){viewer{repositories(first:$first,after:$after,affiliations:[OWNER,COLLABORATOR,ORGANIZATION_MEMBER],orderBy:$order){pageInfo{hasNextPage endCursor}totalCount nodes{' + GQL_REPO_NODE + '}}}}';
const GQL_USERREPOS_Q = 'query($login:String!,$first:Int!,$after:String){repositoryOwner(login:$login){repositories(first:$first,after:$after,orderBy:{field:PUSHED_AT,direction:DESC}){pageInfo{hasNextPage endCursor}totalCount nodes{' + GQL_REPO_NODE + '}}}}';
function repoOrderField(sort) {
  if (sort === 'created') return 'CREATED_AT';
  if (sort === 'updated') return 'UPDATED_AT';
  if (sort === 'full_name') return 'NAME';
  return 'PUSHED_AT'; /* REST 默认 sort=pushed */
}
function restMyRepos(page, sort) {
  return requestAdaptive('repos-my|' + (sort || 'pushed'), per => '/user/repos' + qs({
    page: page,
    per_page: per,
    sort: sort || 'pushed',
    type: 'owner',
    affiliation: 'owner,collaborator,organization_member'
  }), page);
}
function restUserRepos(login, page) {
  return requestAdaptive('repos-user|' + login, per => '/users/' + encodeURIComponent(login) + '/repos' + qs({
    page: page,
    per_page: per,
    sort: 'pushed'
  }), page);
}
const GQL_SEARCH_Q = 'query($q:String!,$first:Int!,$after:String){search(query:$q,type:REPOSITORY,first:$first,after:$after){repositoryCount pageInfo{hasNextPage endCursor} nodes{...on Repository{' + GQL_REPO_NODE + '}}}}';

/* GraphQL search 无 sort 参数，用查询限定符实现（沙箱实证 sort:stars 生效） */
function searchSortQ(sort) {
  if (sort === 'stars') return ' sort:stars';
  if (sort === 'forks') return ' sort:forks';
  if (sort === 'updated') return ' sort:updated';
  return ''; /* best match */
}
function restSearch(keyword, page, sort) {
  return requestAdaptive('search-rest|' + keyword + '|' + (sort || ''), per => '/search/repositories' + qs({
    q: keyword,
    page: page,
    per_page: per,
    sort: sort || 'best match',
    order: 'desc'
  }), page);
}
function trendingQuery(mode) {
  const DAY = 86400000;
  const d = n => {
    const t = new Date(Date.now() - n * DAY);
    return t.getFullYear() + '-' + ('0' + (t.getMonth() + 1)).slice(-2) + '-' + ('0' + t.getDate()).slice(-2);
  };
  if (mode === 'new') return 'stars:>50 created:>' + d(7);
  if (mode === 'rising') return 'stars:>2000 created:>' + d(90);
  return 'stars:>50000';
}
function restTrending(mode, page) {
  return requestAdaptive('trend-rest|' + (mode || 'classic'), per => '/search/repositories' + qs({
    q: trendingQuery(mode),
    page: page,
    per_page: per,
    sort: 'stars',
    order: 'desc'
  }), page);
}
const GQL_REPO_Q = 'query($o:String!,$n:String!){repository(owner:$o,name:$n){nameWithOwner description stargazerCount forkCount watchers{totalCount} issues(states:OPEN){totalCount} primaryLanguage{name} licenseInfo{spdxId} pushedAt updatedAt createdAt isPrivate isFork homepageUrl defaultBranchRef{name} owner{login}}}';
export function getReadme(fullName) {
  return request('/repos/' + fullName + '/readme');
}

/** 目录内容（path 以 '' 为根） */
export function getContents(fullName, path, ref) {
  const p = path ? '/' + path : '';
  return request('/repos/' + fullName + '/contents' + p + qs({
    ref: ref || undefined
  }));
}

/** git 树（v1.1.3）：条目比 contents 接口小 3-4 倍，大目录截断时的回退通道。
 *  sha 传 'HEAD' 取根树，传目录项自带 sha 取子树。 */
export function getTree(fullName, sha) {
  return request('/repos/' + fullName + '/git/trees/' + (sha || 'HEAD'));
}
const GQL_DIR_Q = 'query($o:String!,$n:String!,$e:String!){repository(owner:$o,name:$n){object(expression:$e){__typename ...on Tree{oid entries{name type oid object{...on Blob{byteSize}}}}}}}';
const GQL_BLOB_Q = 'query($o:String!,$n:String!,$e:String!){repository(owner:$o,name:$n){object(expression:$e){__typename ...on Blob{byteSize isBinary text}}}}';
const GQL_ISSUES_Q = 'query($o:String!,$n:String!,$first:Int!,$after:String,$states:[IssueState!]){repository(owner:$o,name:$n){issues(first:$first,after:$after,states:$states,orderBy:{field:CREATED_AT,direction:DESC}){pageInfo{hasNextPage endCursor} nodes{id number title state createdAt author{login} comments{totalCount} labels(first:4){nodes{name color}}}}}}';
function restIssues(fullName, page, state) {
  return requestAdaptive('issues-rest|' + fullName + '|' + (state || 'open'), per => '/repos/' + fullName + '/issues' + qs({
    page: page,
    per_page: per,
    state: state || 'open',
    sort: 'created'
  }), page).then(data => {
    const list = Array.isArray(data) ? data : [];
    const out = [];
    for (let i = 0; i < list.length && out.length < PER_PAGE; i++) {
      if (!list[i].pull_request) out.push(list[i]);
    }
    return out;
  });
}
const GQL_ISSUE_Q = 'query($o:String!,$n:String!,$num:Int!){repository(owner:$o,name:$n){issueOrPullRequest(number:$num){__typename ... on Issue{number title state createdAt author{login} comments{totalCount} labels(first:6){nodes{name color}}} ... on PullRequest{number title state createdAt author{login} comments{totalCount} labels(first:6){nodes{name color}}}}}}';
export function getComments(commentsUrl, page) {
  return requestAdaptive('cmt|' + commentsUrl, per => commentsUrl + qs({
    page: page || 1,
    per_page: per
  }), page || 1);
}

/** 发表 Issue 评论（需 Token，传 comments_url） */
export function addComment(commentsUrl, body) {
  return request(commentsUrl, {
    method: 'POST',
    body: {
      body: body
    }
  });
}
const GQL_RELEASES_Q = 'query($o:String!,$n:String!,$first:Int!,$after:String){repository(owner:$o,name:$n){releases(first:$first,after:$after,orderBy:{field:CREATED_AT,direction:DESC}){pageInfo{hasNextPage endCursor} nodes{id tagName name description isPrerelease publishedAt createdAt author{login} releaseAssets(first:1){totalCount}}}}}';
export function isStarred(fullName) {
  if (!_token) return Promise.resolve(false);
  return request('/user/starred/' + fullName).then(() => true).catch(e => {
    if (e && e.status === 404) return false;
    throw e;
  });
}

/** Star / 取消 Star */
export function setStarred(fullName, on) {
  return request('/user/starred/' + fullName, {
    method: on ? 'PUT' : 'DELETE',
    body: on ? {} : undefined
  });
}

/** 用户主页 */
export function getUser(login) {
  return request('/users/' + encodeURIComponent(login));
}

/* ================= v1.9.0 新功能：PR 列表 / 订阅管理 / Issue 状态切换 =================
 * PR 对象带 head/base 全家桶（单条 5-8KB），per_page=10 必超蓝牙截断阈值 →
 * 走 requestAdaptive 自适应缩页（与 releases REST 同型）。 */

/** 仓库 PR 列表（state: open|closed|all） */
export function getRepoPulls(full, page, state) {
  return requestAdaptive('pulls|' + full + '|' + (state || 'open'), per => '/repos/' + full + '/pulls' + qs({
    state: state || 'open',
    per_page: per,
    page: page || 1
  }), page || 1);
}
const GQL_COMMITS_REF_Q = 'query($o:String!,$n:String!,$branch:String!,$first:Int!,$after:String){repository(owner:$o,name:$n){ref(qualifiedName:$branch){target{... on Commit{history(first:$first,after:$after){pageInfo{hasNextPage endCursor}totalCount nodes{oid committedDate messageHeadline statusCheckRollup{state contexts(first:4){nodes{... on CheckRun{name conclusion status}... on StatusContext{state context}}}}}}}}}}}';
const GQL_COMMITS_DEF_Q = 'query($o:String!,$n:String!,$first:Int!,$after:String){repository(owner:$o,name:$n){defaultBranchRef{target{... on Commit{history(first:$first,after:$after){pageInfo{hasNextPage endCursor}totalCount nodes{oid committedDate messageHeadline statusCheckRollup{state contexts(first:4){nodes{... on CheckRun{name conclusion status}... on StatusContext{state context}}}}}}}}}}}';

/** commit CI 历史瘦映射：rollup state + 前 4 个 check run/context */
function gqlCommitToRest(n) {
  if (!n) return null;
  const roll = n.statusCheckRollup || {};
  const checks = [];
  const ctx = roll.contexts && Array.isArray(roll.contexts.nodes) ? roll.contexts.nodes : [];
  for (let i = 0; i < ctx.length; i++) {
    const c = ctx[i];
    if (!c) continue;
    if (c.name) checks.push({
      name: c.name,
      concl: (c.conclusion || c.status || '').toLowerCase()
    });else if (c.context) checks.push({
      name: c.context,
      concl: (c.state || '').toLowerCase()
    });
  }
  return {
    oid: String(n.oid || ''),
    date: n.committedDate || '',
    headline: n.messageHeadline || '',
    state: roll.state ? String(roll.state).toLowerCase() : '',
    checks: checks
  };
}
const COPILOT_TOK_URL = 'https://api.github.com/copilot_internal/v2/token';
const COPILOT_USER_URL = 'https://api.github.com/copilot_internal/user';
const COPILOT_API_FALLBACK = 'https://api.githubcopilot.com';
/* Copilot CLI 身份（2026 Copilot CLI 同款；Copilot Free 账号 cli_enabled=true）。
 * 交换与调用阶段的身份头必须一致，否则 403 token not authorized for this
 * integration（会话凭据按交换时声明的 integration 鉴权）。 */
/* v1.6.0：身份头改为两条独立第三方生产实证栈（真机 403 主嫌疑是旧自创栈）：
 *  交换段 cpExchHeaders（copilot_internal/v2/token）：LiteLLM authenticator.py
 *    生产验证组合 GithubCopilot/1.155.0 + vscode/1.85.1 + copilot/1.155.0；
 *  调用段 cpIdentityHeaders（chat/completions /models）：LiteLLM
 *    common_utils.get_copilot_default_headers 千级用户验证组合
 *    GitHubCopilotChat/0.26.7 + vscode/1.95.0 + copilot-chat/0.26.7 +
 *    vscode-chat + conversation-panel + 2025-04-01。
 *  （Docker Agent 文档另证 copilot-developer-cli 亦为合法 integration id，
 *   但其完整头栈无公开实现背书；LiteLLM 组合有源码级生产实证，取之。） */
const CP_UA = 'GitHubCopilotChat/0.26.7';
const CP_API_VERSION = '2025-04-01';
function cpExchHeaders() {
  return {
    'User-Agent': 'GithubCopilot/1.155.0',
    'Editor-Version': 'vscode/1.85.1',
    'Editor-Plugin-Version': 'copilot/1.155.0'
  };
}
function cpIdentityHeaders() {
  return {
    'User-Agent': CP_UA,
    'Editor-Version': 'vscode/1.95.0',
    'Editor-Plugin-Version': 'copilot-chat/0.26.7',
    'Copilot-Integration-Id': 'vscode-chat',
    'Openai-Intent': 'conversation-panel'
  };
}

/* v1.7.0 实弹验证（2026-10-10 用户授权全矩阵实测，cp_probe2_result.json）：
 * Copilot Free 真正可用模型仅 gpt-4o-mini / gpt-4.1 / gpt-4o（全部 200 OK，
 * 与官方免费模型集一致）；gpt-5 系/gemini/kimi 等目录模型免费层一律
 * 400 model_not_supported——旧表 6 模型中 4 个是死的，降级白耗 2 轮往返。 */
const AI_MODELS = ['gpt-4o-mini', 'gpt-4.1', 'gpt-4o'];
const AI_MAX_TOKENS = 700;
/* v1.7.0：实弹验证可用模型（置顶排序依据；目录刷新后仍以这三者为默认面） */
const CP_VERIFIED = ['gpt-4o-mini', 'gpt-4.1', 'gpt-4o'];
/* 模型→端点图（copilotModels 由目录顶层 supported_endpoints 填充；
 * 目录 39.5KB 被截断时部分模型缺图 → aiChat 回退 v1.6.0 前缀启发式） */
let _cpModelEp = {};
let _aiModels = AI_MODELS.slice();
let _aiRemoteTs = 0;
let _cpSess = null; /* { token, api, exp(ms) }，提前 2min 判过期 */

/* ---------------- AI 专用 token（ghu_，与主 token 分离存储） ---------------- */
const AI_TOK_KEY = 'gh_copilot_token';
const AI_TOK_FILE = 'internal://files/gh_copilot_token.txt';
let _aiTok = '';
let _aiTokReady = null;

/** 读取 AI token：独立授权优先；无则主 token 为 ghu_/gho_ 时直接复用（旧用户兼容） */
export function loadAiTok(force) {
  if (force) _aiTokReady = null;
  if (_aiTokReady) return _aiTokReady;
  _aiTokReady = function () {
    try {
      return Promise.resolve(stGet(AI_TOK_KEY)).then(function (v) {
        function _temp51() {
          _aiTok = typeof v === 'string' ? v : '';
          const _temp49 = function () {
            if (!_aiTok) {
              return Promise.resolve(loadToken()).then(function () {
                if (aiTokenKind() === 'oauth') _aiTok = String(_token);
              });
            }
          }();
          return _temp49 && _temp49.then ? _temp49.then(function () {
            return _aiTok;
          }) : _aiTok;
        }
        const _temp50 = function () {
          if (!v || typeof v !== 'string' || !v.length) return Promise.resolve(fileGet(AI_TOK_FILE)).then(function (_fileGet2) {
            v = _fileGet2;
          });
        }();
        return _temp50 && _temp50.then ? _temp50.then(_temp51) : _temp51(_temp50);
      });
    } catch (e) {
      return Promise.reject(e);
    }
  }();
  return _aiTokReady;
}
export function hasAiTok() {
  return !!_aiTok;
}
export function aiModels() {
  return _aiModels;
}

/* v1.7.0 远程模型表替换三防（实弹教训：目录 39.5KB 被 8KB 截断后，salvage
 * 片段只含目录头部的死模型，旧版直接拿它当默认表 → AI 全挂）：
 * ① 片段中无任何实证可用模型 → 拒绝替换（保兜底实证表，返回 false）
 * ② 实证可用模型置顶（免费层默认模型直接可用，付费层排其后再上限 12） */
export function aiModelsSetRemote(ids) {
  if (!Array.isArray(ids) || !ids.length) return false;
  let hasVerified = false;
  for (let i = 0; i < ids.length; i++) {
    if (CP_VERIFIED.indexOf(ids[i]) >= 0) {
      hasVerified = true;
      break;
    }
  }
  if (!hasVerified) return false;
  const head = [];
  const tail = [];
  for (let i = 0; i < ids.length && head.length + tail.length < 24; i++) {
    const id = ids[i];
    if (CP_VERIFIED.indexOf(id) >= 0) head.push(id);else tail.push(id);
  }
  const merged = head.concat(tail).slice(0, 12);
  if (!merged.length) return false;
  _aiModels = merged;
  return true;
}

/** 主 token 形态：pat（ghp_/github_pat_）| oauth（ghu_/gho_）| none */
export function aiTokenKind() {
  if (!_token) return 'none';
  const t = String(_token);
  if (t.indexOf('ghu_') === 0 || t.indexOf('gho_') === 0) return 'oauth';
  return 'pat';
}

/** 通道可用性标签（AI 页状态行） */
export function aiChannelLabel() {
  if (aiTokenKind() === 'oauth') return 'Copilot · 主token直连';
  if (_aiTok) return 'Copilot · 已授权';
  if (aiTokenKind() === 'pat') return 'Copilot · 待授权';
  return '需登录 Token';
}
function respText(d) {
  if (d && typeof d.output_text === 'string' && d.output_text.length) return d.output_text;
  if (d && Array.isArray(d.output)) {
    let s = '';
    for (let i = 0; i < d.output.length; i++) {
      const o = d.output[i];
      if (!o || o.type === 'reasoning') continue;
      const c = o.content;
      if (Array.isArray(c)) {
        for (let j = 0; j < c.length; j++) {
          if (c[j] && typeof c[j].text === 'string') s += c[j].text;
        }
      }
    }
    return s;
  }
  return '';
}
export default {
  loadToken,
  hasToken,
  currentToken,
  saveToken,
  clearToken,
  validateToken,
  tokenFormatHint,
  rateInfo,
  request,
  qs,
  self,
  lastListPerPage,
  storageDiag,
  verifyPersisted,
  clearCache,
  getRateLimit,
  getNotifications,
  notifPageSize,
  lastNotifGaps,
  markAllNotificationsRead,
  markThreadRead,
  markRepoNotificationsRead,
  getSubject,
  getMyRepos,
  getUserRepos,
  searchRepos,
  getTrending,
  getRepo,
  getReadme,
  getReadmeText,
  getContents,
  getFileRaw,
  getFileRawEx,
  getTree,
  getTreeEx,
  getIssues,
  getIssue,
  getComments,
  addComment,
  getReleases,
  isStarred,
  setStarred,
  getUser,
  getRepoPulls,
  getRepoSubscription,
  setRepoSubscription,
  patchIssueState,
  bridgeInfo,
  bridgeSetMode,
  bridgeDetect,
  bridgeDiagnoseHost,
  deviceFlowStart,
  deviceFlowPoll,
  utf8DecodeChunk,
  getCommitChecks,
  markThreadsRead,
  loadAiTok,
  saveAiTok,
  hasAiTok,
  aiChat,
  aiModels,
  aiModelsSetRemote,
  copilotModels,
  aiProbe,
  aiTokenKind,
  aiChannelLabel,
  getDirList,
  ghqlBlob,
  lastSalvageInfo
};