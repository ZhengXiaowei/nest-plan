import {create} from 'zustand';

/**
 * AI 接口设置：全部由用户在浏览器里填写，只保存在本机。
 * 不经过任何栖图服务器，请求直接从浏览器发到用户填写的接口地址。
 */
export type AiProtocol = 'openai' | 'anthropic';

export interface AiSettings {
  protocol: AiProtocol;
  /** OpenAI 兼容协议填到 /v1 为止，例如 https://api.openai.com/v1；Anthropic 填 https://api.anthropic.com */
  baseUrl: string;
  apiKey: string;
  /** 需要支持图片输入的模型 */
  model: string;
  /** true 存 localStorage（下次打开还在），false 只存 sessionStorage（关掉标签页就清除） */
  remember: boolean;
  /**
   * 深度思考。只对能用请求参数关掉思考的接口生效（见 client.ts 的 canToggleThinking），默认关：
   * 户型识别靠看图出坐标，思考帮助不大，还会把输出额度用完。
   */
  thinking: boolean;
}

const KEY = 'nestplan:ai-settings';

const EMPTY: AiSettings = {protocol: 'openai', baseUrl: '', apiKey: '', model: '', remember: false, thinking: false};

function load(): AiSettings {
  try {
    const raw = localStorage.getItem(KEY) ?? sessionStorage.getItem(KEY);
    return raw ? {...EMPTY, ...(JSON.parse(raw) as Partial<AiSettings>)} : EMPTY;
  } catch {
    return EMPTY;
  }
}

function save(s: AiSettings) {
  try {
    localStorage.removeItem(KEY);
    sessionStorage.removeItem(KEY);
    (s.remember ? localStorage : sessionStorage).setItem(KEY, JSON.stringify(s));
  } catch {
    // 存储不可用时只保留在内存里
  }
}

interface AiSettingsState {
  settings: AiSettings;
  dialogOpen: boolean;
  setSettings: (s: AiSettings) => void;
  clear: () => void;
  openDialog: (open: boolean) => void;
}

export const useAiSettings = create<AiSettingsState>()((set) => ({
  settings: load(),
  dialogOpen: false,
  setSettings: (settings) => {
    save(settings);
    set({settings});
  },
  clear: () => {
    try {
      localStorage.removeItem(KEY);
      sessionStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    set({settings: EMPTY});
  },
  openDialog: (dialogOpen) => set({dialogOpen}),
}));

export const isAiConfigured = (s: AiSettings) => Boolean(s.baseUrl && s.apiKey && s.model);
