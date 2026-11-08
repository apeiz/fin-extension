/**
 * 测试依赖加载
 *
 * 扩展本身零运行时依赖，只有测试与截图工具需要 jsdom / puppeteer-core。
 * 优先用项目里的 node_modules；没有就退到 NODE_PATH 与全局安装目录，
 * 免得每个脚本各写一份查找逻辑。
 */

'use strict';

const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

let roots = null;

function searchRoots() {
  if (roots) return roots;
  const list = [];
  const envPath = process.env.NODE_PATH;
  if (envPath) {
    envPath.split(path.delimiter).forEach(function (p) {
      if (p) list.push(p);
    });
  }
  try {
    const out = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', timeout: 5000 });
    if (out && out.trim()) list.push(out.trim());
  } catch (e) {
    // 没有 npm 也不影响：下面的固定目录会兜底
  }
  list.push(path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules'));
  list.push('/usr/local/lib/node_modules');
  list.push('/usr/lib/node_modules');
  roots = list;
  return roots;
}

function loadDep(name) {
  try {
    return require(name);
  } catch (e) {
    // 继续找，最后统一报错
  }
  for (const root of searchRoots()) {
    try {
      return require(path.join(root, name));
    } catch (e) {
      // 换下一个
    }
  }
  throw new Error('找不到依赖 ' + name + '。在项目目录执行 npm install，或 npm i -g ' + name);
}

module.exports = { loadDep: loadDep };
