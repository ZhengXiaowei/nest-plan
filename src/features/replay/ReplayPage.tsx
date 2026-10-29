import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Button} from '@astryxdesign/core/Button';
import {navigate} from '../../lib/router';

/**
 * 改造回放（规划中）：从原始户型一步步演变到最终方案，
 * 拆改墙体 → 铺地面刷墙 → 家具落位 → 第一视角漫游，并可导出 MP4。
 * 时间线和导出方案见 docs/plan.md。
 */
export default function ReplayPage() {
  return (
    <main className="np-replay">
      <EmptyState
        title="改造回放正在做"
        description="完成设计后，这里会用动画把毛坯一步步变成你的方案：拆改墙体、铺地面、家具落位，最后用第一视角走一遍每个房间，还能导出视频。"
        actions={<Button label="回到设计" variant="primary" onClick={() => navigate('design')} />}
      />
    </main>
  );
}
