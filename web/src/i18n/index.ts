import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { storage } from "@/lib/utils";
import en from "./en";
import ru from "./ru";

export const LANGUAGES = ["ru", "en"] as const;
export type Language = (typeof LANGUAGES)[number];

const STORAGE_KEY = "tm-admin.lang";

function initialLanguage(): Language {
  const saved = storage.get(STORAGE_KEY);
  return saved === "en" || saved === "ru" ? saved : "ru";
}

void i18n.use(initReactI18next).init({
  resources: { ru: { translation: ru }, en: { translation: en } },
  lng: initialLanguage(),
  fallbackLng: "ru",
  supportedLngs: [...LANGUAGES],
  interpolation: { escapeValue: false },
});

function syncHtmlLang(lng: string): void {
  if (typeof document !== "undefined") document.documentElement.lang = lng;
}
syncHtmlLang(i18n.language);
i18n.on("languageChanged", syncHtmlLang);

export function setLanguage(lng: Language): void {
  storage.set(STORAGE_KEY, lng);
  void i18n.changeLanguage(lng);
}

export function currentLanguage(): Language {
  return i18n.language === "en" ? "en" : "ru";
}

export default i18n;
