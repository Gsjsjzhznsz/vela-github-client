/**
 * Vela 内联键盘共享逻辑（BandQQ InputMethod 移植版）
 *
 * 背景：gh-keyboard 自定义组件在此固件上整个子树不渲染（实测），
 * 改为页面内联模板 + 本模块提供数据构建/原地更新。
 * 按键结构：{ label, act, ch, st }  st 为内联 style（''=默认样式）
 */

const LOWER = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm']
const NUM1 = '1234567890'
const NUM2 = '-_./:@#&+'
const NUM3 = "$%()!?;'\""
const TAIL = [',', '.', '_', '-']

function charKey(ch, shift) {
  return { label: shift ? ch.toUpperCase() : ch, act: 'char', ch: ch, st: '' }
}

function fnKey(label, act) {
  return { label: label, act: act, st: 'flex:1.4;background-color:#30363d' }
}

export function buildRows(mode, shift) {
  const rows = []
  if (mode === 'abc') {
    rows.push(LOWER[0].split('').map((c) => charKey(c, shift)))
    rows.push(LOWER[1].split('').map((c) => charKey(c, shift)))
    const r2 = [fnKey('↑', 'shift')]
    LOWER[2].split('').forEach((c) => r2.push(charKey(c, shift)))
    r2.push(fnKey('←', 'del'))
    rows.push(r2)
  } else {
    rows.push(NUM1.split('').map((c) => charKey(c, false)))
    rows.push(NUM2.split('').map((c) => charKey(c, false)))
    const r2 = [fnKey('#', 'noop')]
    NUM3.split('').forEach((c) => r2.push(charKey(c, false)))
    r2.push(fnKey('←', 'del'))
    rows.push(r2)
  }
  const r3 = [fnKey(mode === 'abc' ? '123' : 'abc', 'mode')]
  TAIL.forEach((c) => r3.push(charKey(c, false)))
  r3.push({ label: '空格', act: 'space', st: 'flex:4' })
  r3.push({ label: '完成', act: 'ok', st: 'flex:3;background-color:#238636' })
  rows.push(r3)
  return rows // [row0..row3]
}

/** 原地更新按键标签/样式，避免整树重建 */
export function applyRows(cur, next) {
  for (let ri = 0; ri < 4; ri++) {
    for (let ki = 0; ki < next[ri].length && ki < cur[ri].length; ki++) {
      cur[ri][ki].label = next[ri][ki].label
      cur[ri][ki].st = next[ri][ki].st
    }
  }
}
