import React, { createContext, useContext, useEffect, useState } from 'react';
import { Languages } from 'lucide-react';
import { translate, translateError, dateLocale } from '../electron/i18n.mjs';
import './language.css';

const LanguageContext = createContext(null);
const storageKey = 'aegis.ui.language';
export function LanguageProvider({ children }) {
  const [language, setLanguage] = useState('ko');
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const value = window.btk?.preferences
          ? (await window.btk.preferences.read()).language : localStorage.getItem(storageKey);
        if (active && ['ko', 'en'].includes(value)) setLanguage(value);
      } catch { if (active) setError(true); }
      finally { if (active) setReady(true); }
    })();
    return () => { active = false; };
  }, []);
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  async function changeLanguage(value) {
    if (saving || !['ko', 'en'].includes(value)) return;
    setSaving(true); setError(false);
    try {
      if (window.btk?.preferences) await window.btk.preferences.save(value);
      else localStorage.setItem(storageKey, value);
      setLanguage(value);
    } catch { setError(true); }
    finally { setSaving(false); }
  }
  const value = { language, locale: dateLocale(language), saving, error, changeLanguage,
    t: (key, values) => translate(key, language, values), errorText: text => translateError(text, language) };
  return <LanguageContext.Provider value={value}>{ready ? children : <div className="edition-choice" role="status">{value.t('설정 확인 중')}</div>}</LanguageContext.Provider>;
}
export const useI18n = () => useContext(LanguageContext);
export function LanguageSelect() {
  const { language, changeLanguage, saving, error, t } = useI18n();
  return <div className="language-control">
    <label title={t('언어')}><Languages size={16} aria-hidden="true" />
      <select aria-label="언어 / Language" value={language} disabled={saving}
        onChange={event => changeLanguage(event.target.value)}>
        <option value="ko">한국어</option><option value="en">English</option>
      </select>
    </label>
    {error && <small role="alert">{t('언어 설정을 저장하지 못했습니다.')}</small>}
  </div>;
}
