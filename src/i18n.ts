import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import zh from './locales/zh.json'
import en from './locales/en.json'

// 从 localStorage 读取语言偏好，默认中文
const savedLang = localStorage.getItem('qai-language') || 'zh'

i18n
  .use(initReactI18next)
  .init({
    resources: {
      zh: { translation: zh },
      en: { translation: en },
    },
    lng: savedLang,
    fallbackLng: 'zh',
    interpolation: {
      escapeValue: false, // React 已处理 XSS
    },
  })

export function changeLanguage(lang: string) {
  i18n.changeLanguage(lang)
  localStorage.setItem('qai-language', lang)
}

export default i18n
