#!/usr/bin/env python3
# diag_promo_patch.py — 宣传图/渲染诊断构建补丁（不随包发布，用完 git 还原）
# 用法：
#   python3 scripts/diag_promo_patch.py home   # home 页注入已登录态 mock
#   python3 scripts/diag_promo_patch.py ai     # ai 页注入示例对话 + 跳过授权门
#   python3 scripts/diag_promo_patch.py entry pages/ai   # 切 manifest 首页
#   python3 scripts/diag_promo_patch.py restore          # git 还原全部补丁
import re, subprocess, sys

def patch_home():
    p = 'src/pages/home/home.ux'
    s = open(p, encoding='utf-8').read()
    mock = ("onShow: function () {\n"
            "    /* DIAG-MOCK 宣传图已登录态（真机构建绝不带此段） */\n"
            "    this.hasTk = true; this.tokenMask = 'ghp_····kQ3'; this.loginName = 'Gsjsjzhznsz';\n"
            "    this.avCh = 'G'; this.avColor = '#1f6feb'; this.rateText = '4892/5000';\n"
            "    return Promise.resolve();\n")
    assert 'onShow: function () {' in s, 'home onShow 锚点丢失'
    s = s.replace('onShow: function () {', mock, 1)
    open(p, 'w', encoding='utf-8').write(s)
    print('[patch] home 已登录态 mock 注入')

def patch_ai():
    p = 'src/pages/ai/ai.ux'
    s = open(p, encoding='utf-8').read()
    mock_onshow = ("onShow: function () {\n"
                   "    /* DIAG-MOCK 渲染诊断：跳过授权门 */\n"
                   "    this.state = 'ok'; this.needCp = false;\n"
                   "    return Promise.resolve();\n")
    assert 'onShow: function () {' in s, 'ai onShow 锚点丢失'
    s = s.replace('onShow: function () {', mock_onshow, 1)
    mock_msgs = ("onInit() {\n"
                 "    /* DIAG-MOCK 示例对话（渲染诊断） */\n"
                 "    this.msgs = [\n"
                 "      { id: 'a1', role: 'user', text: '帮我总结一下这个仓库是做什么的', meta: '', think: '', thinkOpen: false },\n"
                 "      { id: 'a2', role: 'ai', text: '这是一个运行在小米 Vela 手环上的 GitHub 客户端，支持通知中心、仓库浏览、趋势榜单、Issues 管理和 Copilot AI 对话。', meta: 'Copilot · GPT-4o mini · 2.3s · 356 tokens', think: '', thinkOpen: false },\n"
                 "      { id: 'a3', role: 'user', text: 'Copilot 授权怎么弄？', meta: '', think: '', thinkOpen: false },\n"
                 "      { id: 'a4', role: 'ai', text: '进首页设置选免打字登录，手环显示设备码后，浏览器打开 github.com/login/device 输入即可完成授权。', meta: 'Copilot · GPT-4o mini · 1.8s · 289 tokens', think: '', thinkOpen: false }\n"
                 "    ];\n")
    assert 'onInit() {' in s, 'ai onInit 锚点丢失'
    s = s.replace('onInit() {', mock_msgs, 1)
    open(p, 'w', encoding='utf-8').write(s)
    print('[patch] ai 示例对话注入')

def patch_entry(page):
    p = 'src/manifest.json'
    s = open(p, encoding='utf-8').read()
    s2, n = re.subn(r'"entry": "[^"]+"', '"entry": "%s"' % page, s)
    assert n == 1, 'entry 锚点异常 n=%d' % n
    open(p, 'w', encoding='utf-8').write(s2)
    print('[patch] entry ->', page)

def restore():
    subprocess.run(['git', 'checkout', '--', 'src/pages/home/home.ux', 'src/pages/ai/ai.ux', 'src/manifest.json'], check=True)
    print('[restore] git checkout 完成')

if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    if cmd == 'home': patch_home()
    elif cmd == 'ai': patch_ai()
    elif cmd == 'entry': patch_entry(sys.argv[2])
    elif cmd == 'restore': restore()
    else: print('unknown cmd'); sys.exit(2)
