import { expect, type Page } from "@playwright/test";

export type TestLocale = "zh-CN" | "en";

const LOCALE_TITLES: Record<TestLocale, string> = {
  "zh-CN": "设置",
  en: "Settings"
};

const DOCUMENT_LANG_ATTRIBUTES: Record<TestLocale, string> = {
  "zh-CN": "zh-CN",
  en: "en"
};

/**
 * 在 options 页上显式切换界面语言，并等待文档标题 / <html lang> 都更新完成。
 *
 * 扩展默认 locale.mode 是 "system"，会跟随 chrome.i18n.getUILanguage()；测试环境里
 * 即使 fixtures 已固定 locale:"zh-CN"，单个用例仍应显式设置语言，避免断言依赖浏览器
 * 系统语言而悄悄漂移。切换语言会写入 chrome.storage，设置页和侧边栏都会立即更新。
 */
export async function setLocale(optionsPage: Page, locale: TestLocale): Promise<void> {
  await optionsPage.selectOption("#locale-mode", locale);
  await expect(optionsPage).toHaveTitle(LOCALE_TITLES[locale]);
  await expect(optionsPage.locator("html")).toHaveAttribute(
    "lang",
    DOCUMENT_LANG_ATTRIBUTES[locale]
  );
}

/** 在 options 页读取当前 #locale-mode 的值（"system" | "zh-CN" | "en"）。 */
export async function getLocaleMode(optionsPage: Page): Promise<string> {
  return optionsPage.locator("#locale-mode").inputValue();
}
