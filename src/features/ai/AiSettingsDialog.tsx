import {useEffect, useState} from 'react';
import {Dialog, DialogHeader} from '@astryxdesign/core/Dialog';
import {SegmentedControl, SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Switch} from '@astryxdesign/core/Switch';
import {Button} from '@astryxdesign/core/Button';
import {Banner} from '@astryxdesign/core/Banner';
import {VStack, HStack} from '@astryxdesign/core/Stack';
import {useAiSettings, type AiProtocol, type AiSettings} from './settings';
import {canToggleThinking, complete} from './client';

const PLACEHOLDER: Record<AiProtocol, string> = {
  openai: 'https://api.openai.com/v1（或任意 OpenAI 兼容地址）',
  anthropic: 'https://api.anthropic.com',
};

export default function AiSettingsDialog() {
  const {settings, dialogOpen, openDialog, setSettings, clear} = useAiSettings();
  const [draft, setDraft] = useState<AiSettings>(settings);
  const [test, setTest] = useState<{state: 'idle' | 'running' | 'ok' | 'error'; message?: string}>({state: 'idle'});

  useEffect(() => {
    if (dialogOpen) {
      setDraft(settings);
      setTest({state: 'idle'});
    }
  }, [dialogOpen, settings]);

  const set = <K extends keyof AiSettings>(k: K, v: AiSettings[K]) => setDraft((d) => ({...d, [k]: v}));
  const deepseek = canToggleThinking(draft);

  const runTest = async () => {
    setTest({state: 'running'});
    try {
      // 只给 16 个 token，开着思考的模型来不及回复，所以测试时固定不开思考
      const reply = await complete(draft, {text: '只回复两个字：可以', maxTokens: 16, thinking: false});
      setTest({state: 'ok', message: `连接成功，模型回复：${reply.slice(0, 40)}`});
    } catch (e) {
      setTest({state: 'error', message: e instanceof Error ? e.message : String(e)});
    }
  };

  return (
    <Dialog isOpen={dialogOpen} onOpenChange={openDialog} width={480} purpose="form">
      <DialogHeader title="连接 AI 模型" subtitle="户型识别和 AI 助手会用这里填的接口" onOpenChange={openDialog} />
      <VStack gap={4} padding={4}>
        <SegmentedControl label="接口协议" value={draft.protocol} onChange={(v) => set('protocol', v as AiProtocol)} layout="fill">
          <SegmentedControlItem value="openai" label="OpenAI 兼容" />
          <SegmentedControlItem value="anthropic" label="Anthropic" />
        </SegmentedControl>
        <TextInput label="接口地址" value={draft.baseUrl} placeholder={PLACEHOLDER[draft.protocol]} onChange={(v) => set('baseUrl', v.trim())} />
        <TextInput label="API 密钥" type="password" value={draft.apiKey} autoComplete="off" onChange={(v) => set('apiKey', v.trim())} />
        <TextInput
          label="模型名"
          description={deepseek ? '需要支持图片输入：DeepSeek 用 deepseek-flash，deepseek-v4-pro 看不了图' : '需要支持图片输入'}
          value={draft.model}
          onChange={(v) => set('model', v.trim())}
        />
        {deepseek && (
          <Switch
            label="深度思考"
            description="DeepSeek 默认会深度思考。户型识别建议关掉：更快、更省，也不会把输出额度用完"
            value={draft.thinking}
            onChange={(v) => set('thinking', v)}
          />
        )}
        <Switch label="在这台设备上记住" description="关闭时，关掉页面就清除密钥" value={draft.remember} onChange={(v) => set('remember', v)} />
        <Banner
          status="info"
          title="密钥只保存在你的浏览器里"
          description="请求直接从浏览器发到你填写的地址，不经过栖图的服务器。建议使用单独创建、额度受限的密钥。"
        />
        {test.state === 'ok' && <Banner status="success" title={test.message} />}
        {test.state === 'error' && <Banner status="error" title="连接失败" description={test.message} />}
        <HStack gap={2} justify="end">
          <Button label="清除" variant="ghost" onClick={() => { clear(); openDialog(false); }} />
          <Button label="测试连接" variant="secondary" isLoading={test.state === 'running'} isDisabled={!draft.baseUrl || !draft.apiKey || !draft.model} onClick={runTest} />
          <Button label="保存" variant="primary" onClick={() => { setSettings(draft); openDialog(false); }} />
        </HStack>
      </VStack>
    </Dialog>
  );
}
