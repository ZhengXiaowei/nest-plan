import {lazy, Suspense, useState, type ReactNode} from 'react';
import {Button} from '@astryxdesign/core/Button';

export type MenuKind = 'layers' | 'plan' | 'scene';

// 菜单第一次点开时才加载
const loadMenu = () => import('./menus');
const Menu = lazy(loadMenu);

/** 先放一个普通按钮，点了再换成真正的下拉菜单并直接打开 */
export function LazyMenu({kind, label, icon}: {kind: MenuKind; label: string; icon?: ReactNode}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const plain = (
    <Button
      label={label}
      icon={icon}
      variant="ghost"
      size="sm"
      onPointerEnter={() => void loadMenu()}
      onFocus={() => void loadMenu()}
      onClick={() => {
        setMounted(true);
        setOpen(true);
      }}
    />
  );
  if (!mounted) return plain;
  return (
    <Suspense fallback={plain}>
      <Menu kind={kind} label={label} icon={icon} isOpen={open} onOpenChange={setOpen} />
    </Suspense>
  );
}
