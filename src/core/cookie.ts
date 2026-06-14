import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { getCookies, toCookieHeader } from "@steipete/sweet-cookie";

const COOKIE_FILE = ".cookie";

export async function readCookie(
  baseDirectory: string,
): Promise<string> {
  const cookiePath = path.resolve(baseDirectory, COOKIE_FILE);
  try {
    const content = await readFile(cookiePath, "utf8");
    const cookie = content.trim();
    if (cookie) {
      return cookie;
    }
  } catch {
    // 文件不存在
  }
  throw new Error(
    `Cookie 文件不存在，请先运行 npm run cli -- cookie 从浏览器获取`,
  );
}

export async function fetchAndSaveCookie(
  baseDirectory: string,
): Promise<{ cookiePath: string; cookieCount: number }> {
  console.error("正在读取浏览器 cookie，如果弹出权限请求请点击允许...");
  const { cookies, warnings } = await getCookies({
    url: "https://music.163.com/",
    browsers: ["chrome", "edge", "firefox", "safari"],
    timeoutMs: 30_000,
  });

  for (const w of warnings) {
    console.warn("Warning:", w);
  }

  if (cookies.length === 0) {
    throw new Error("未找到网易云音乐的cookie，请先在edge,chrome,firefox,safari浏览器中登录 music.163.com");
  }

  const cookieHeader = toCookieHeader(cookies, { dedupeByName: true });
  const cookiePath = path.resolve(baseDirectory, COOKIE_FILE);
  await writeFile(cookiePath, cookieHeader, "utf8");
  console.error(`保存成功！`);

  return { cookiePath, cookieCount: cookies.length };
}
