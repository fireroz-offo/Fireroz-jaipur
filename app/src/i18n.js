const D = {
  en: { home: 'Home', patients: 'Patients', queue: 'Queue', reports: 'Reports', settings: 'Settings', login: 'Login', signup: 'Sign Up', tagline: 'Manage Your Clinic Smartly.', brand: 'Dare to Be Different.',
    today: "Today's Patients", walkin: 'Walk-in Entry', search: 'Patient Search', rx: 'Create Prescription', live: 'Live Queue', next: 'NEXT', hold: 'HOLD', resume: 'RESUME', skip: 'SKIP', noshow: 'NO-SHOW', complete: 'COMPLETE', logout: 'Logout', lang: 'Language' },
  hi: { home: 'होम', patients: 'मरीज़', queue: 'कतार', reports: 'रिपोर्ट', settings: 'सेटिंग्स', login: 'लॉगिन', signup: 'साइन अप', tagline: 'अपना क्लिनिक स्मार्ट तरीके से चलाएं।', brand: 'कुछ अलग करने की हिम्मत रखो।',
    today: 'आज के मरीज़', walkin: 'वॉक-इन एंट्री', search: 'मरीज़ खोजें', rx: 'पर्चा बनाएं', live: 'लाइव कतार', next: 'अगला', hold: 'रोकें', resume: 'शुरू करें', skip: 'छोड़ें', noshow: 'अनुपस्थित', complete: 'पूरा', logout: 'लॉगआउट', lang: 'भाषा' }
};
export const getLang = () => localStorage.getItem('lang') || 'en';
export const setLang = l => { localStorage.setItem('lang', l); location.reload(); };
export const t = k => D[getLang()][k] || D.en[k] || k;
