/* band9_sim.js — Vela 官方 QEMU 模拟器编排（band 192×490 / band-pro 336×480）
 * 依据 node_modules/@aiot-toolkit/emulator 2.0.5 SDK API 重建（上轮 start_band9.js 未入库被清，本版补录入库）
 * 子命令：
 *   setup                          下载 SDK(emulator/qa/skins/modem) + vela-watch-5.0 镜像（可自定义尺寸）
 *   avd                            建 band9(192×490) + band9pro(336×480) 两台 rect AVD
 *   boot <avd>                     无头启动并等待 boot completed（幂等：已启则复用）
 *   install <avd> <rpk>            adb push + pm install（失败非零退出）
 *   uninstall <avd> <pkg>          am stop + pm uninstall（运行中卸载会静默失败，先停）
 *   start <avd> <pkg>              am start 并等 Start main loop
 *   shot <avd> <out.png>           grpc getScreenshot 存 PNG
 *   stop <avd>                     杀 qemu（pkill -f "avd <name>"）
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const EMU = path.resolve(__dirname, '../node_modules/@aiot-toolkit/emulator');
const { VvdManager, Vela5Instance } = require(EMU);
const VelaImageType = require(path.join(EMU, 'lib/typing/Vvd')).VelaImageType;

const SDK_HOME = '/home/z/.vela/sdk';
const VVD_HOME = '/home/z/.vela/vvd';
process.env.ANDROID_AVD_HOME = VVD_HOME; // SDK 查 AVD 走此 env（上轮踩坑：缺省指向 ~/.android/avd 找不到）

const AVDS = {
  band9: { name: 'band9', width: '192', height: '490', shape: 'rect', density: '240', arch: 'arm', customLcdRadius: '24', grpcPort: 18556, imageType: VelaImageType.VELA_WATCH_5 },
  band9pro: { name: 'band9pro', width: '336', height: '480', shape: 'rect', density: '240', arch: 'arm', customLcdRadius: '30', grpcPort: 18557, imageType: VelaImageType.VELA_WATCH_5 }
};

function mgr() {
  return new VvdManager({ vvdHome: VVD_HOME, sdkHome: SDK_HOME });
}

async function cmdSetup() {
  const m = mgr();
  fs.mkdirSync(SDK_HOME, { recursive: true });
  console.log('[setup] downloadSDK ...');
  const dl = await m.downloadSDK({ force: false, cliProgress: false, parallelDownloads: 6 });
  await dl.downlodPromise;
  console.log('[setup] downloadImage vela-watch-5.0 ...');
  const d2 = await m.downloadImage(VelaImageType.VELA_WATCH_5, { skipExisting: true, cliProgress: false });
  await d2.download();
  console.log('[setup] OK');
  const imgDir = path.join(SDK_HOME, 'system-images', 'vela-watch-5.0');
  console.log('[setup] image dir:', imgDir, fs.existsSync(imgDir) ? fs.readdirSync(imgDir).join(',') : 'MISSING');
}

async function cmdAvd() {
  const m = mgr();
  const imageDir = path.join(SDK_HOME, 'system-images', 'vela-watch-5.0');
  if (!fs.existsSync(path.join(imageDir, 'system.img')) && !fs.existsSync(path.join(imageDir, 'vela_system.bin'))) throw new Error('image not ready: ' + imageDir);
  for (const k of Object.keys(AVDS)) {
    const p = { ...AVDS[k], imageDir };
    try {
      m.createVvd(p);
      console.log('[avd] created', p.name, p.width + 'x' + p.height);
    } catch (e) {
      console.log('[avd] create fail(可能已存在)', p.name, String(e.message || e).slice(0, 120));
    }
  }
}

async function getInst(name, opts = {}) {
  const m = mgr();
  const avd = AVDS[name] || {};
  const r = await m.startVvd({
    vvdName: name,
    qtHideWindow: true, // 无头必须：默认 -no-window 在本 SDK 走 Qt xcb 崩溃路径（上轮踩坑）
    grpcPort: avd.grpcPort || 18556, // 必须显式：不传 -grpc 则本 SDK 无 grpc/running 文件，截图链路失效
    ...opts
  });
  return r;
}

async function cmdBoot(name) {
  const r = await getInst(name);
  console.log('[boot]', name, r.coldBoot ? 'cold-booted' : 'already-running');
  console.log('[boot] serial:', r.emulatorInstance.sn);
}

async function cmdInstall(name, rpk) {
  const r = await getInst(name);
  await r.emulatorInstance.pushAndInstall(path.resolve(rpk), 'io.github.gsjsjzhznsz.github');
  console.log('[install] OK', rpk);
}

async function cmdUninstall(name, pkg) {
  const r = await getInst(name);
  try { await r.emulatorInstance.stopApp ? await r.emulatorInstance.stopApp(pkg) : null; } catch (e) {}
  try {
    await execSync(`adb -s ${r.emulatorInstance.sn} shell am stop`, { stdio: 'inherit' });
  } catch (e) {}
  await new Promise(res => setTimeout(res, 1500));
  try {
    const out = await require(EMU + '/node_modules/@miwt/adb').execAdbCmdAsync(
      `adb -s ${r.emulatorInstance.sn} shell pm uninstall ${pkg}`);
    console.log('[uninstall]', String(out).trim());
  } catch (e) { console.log('[uninstall] fail', String(e)); }
}

async function cmdStart(name, pkg) {
  const r = await getInst(name);
  await r.emulatorInstance.startApp(pkg);
  console.log('[start] OK', pkg);
}

async function cmdShot(name, out, waitMs) {
  const r = await getInst(name);
  const g = r.getAgent();
  await g.waitForReady(6000).catch(e => { throw new Error('grpc not ready: ' + e); });
  const resp = await g.getScreenshot(); // SDK 直接 resolve 图片 Buffer（d.ts: getScreenshot(): Promise<Buffer>）
  const buf = resp ? Buffer.from(resp) : null;
  if (!buf || buf.length < 100) throw new Error('empty screenshot');
  fs.writeFileSync(path.resolve(out), buf);
  console.log('[shot]', out, buf.length, 'bytes');
}

/* cycle：停→清 vela_data.bin→boot→install→start→等→shot（virgin 状态，根治快照/旧实例残留） */
async function cmdCycle(name, rpk, out, waitMs) {
  await cmdStop(name);
  await new Promise(res => setTimeout(res, 2000));
  const datBin = path.join(VVD_HOME, name + '.vvd', 'vela_data.bin');
  if (fs.existsSync(datBin)) { fs.rmSync(datBin); console.log('[cycle] wiped', datBin); }
  await cmdBoot(name);
  await cmdInstall(name, rpk);
  try { await cmdStart(name, 'io.github.gsjsjzhznsz.github'); } catch (e) { console.log('[cycle] start flag timeout(非致命，继续等)'); }
  await new Promise(res => setTimeout(res, waitMs || 6000));
  await cmdShot(name, out);
}

async function cmdStop(name) {
  try {
    execSync(`pkill -f "\\-avd ${name}( |$)"`, { stdio: 'ignore' });
    execSync(`pkill -f qemu-system-armel.*${name}`, { stdio: 'ignore' });
  } catch (e) {}
  console.log('[stop]', name);
}

(async () => {
  const [, , cmd, ...args] = process.argv;
  try {
    if (cmd === 'setup') await cmdSetup();
    else if (cmd === 'avd') await cmdAvd();
    else if (cmd === 'boot') await cmdBoot(args[0]);
    else if (cmd === 'install') await cmdInstall(args[0], args[1]);
    else if (cmd === 'uninstall') await cmdUninstall(args[0], args[1]);
    else if (cmd === 'start') await cmdStart(args[0], args[1]);
    else if (cmd === 'shot') await cmdShot(args[0], args[1]);
    else if (cmd === 'cycle') await cmdCycle(args[0], args[1], args[2], parseInt(args[3] || '6000'));
    else if (cmd === 'stop') await cmdStop(args[0]);
    else { console.log(__doc__ || 'unknown cmd'); process.exit(2); }
    process.exit(0);
  } catch (e) {
    console.error('[FATAL]', cmd, String(e && e.message || e).slice(0, 400));
    process.exit(1);
  }
})();
