import { enMessages } from "./messages/en.js";
import { jaMessages } from "./messages/ja.js";

export const SUPPORTED_LOCALES = ["en", "ja"];

const MESSAGES = {
  en: enMessages,
  ja: jaMessages,
};

function getPathValue(object, key) {
  return key.split(".").reduce((value, part) => value?.[part], object);
}

export function detectInitialLocale() {
  if (typeof navigator === "undefined") {
    return "en";
  }
  return navigator.language?.toLowerCase().startsWith("ja") ? "ja" : "en";
}

export function translate(locale, key, params = {}) {
  const activeLocale = SUPPORTED_LOCALES.includes(locale) ? locale : "en";
  const template =
    getPathValue(MESSAGES[activeLocale], key) ?? getPathValue(MESSAGES.en, key) ?? key;

  if (typeof template !== "string") {
    return key;
  }

  return template.replace(/\{(\w+)\}/g, (_, token) => {
    const value = params[token];
    return value === undefined || value === null ? "" : String(value);
  });
}
